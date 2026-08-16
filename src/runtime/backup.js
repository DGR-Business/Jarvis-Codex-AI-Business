const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { pipeline } = require("node:stream/promises");
const { DatabaseSync, backup } = require("node:sqlite");
const CONFIG = require("../config");
const { LATEST_SCHEMA_VERSION, openDatabase, verifyDatabase } = require("../db");
const { sha256: sha256Value } = require("./commercial-test-contract");

const MAGIC = Buffer.from("JARVISBK1", "ascii");
const AUTH_TAG_BYTES = 16;
const MAX_HEADER_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 16 * 1024 * 1024;
const RECOVERY_SET_FORMAT = "pantheon-recovery-set";
const RECOVERY_SET_VERSION = 1;
const RECOVERY_METADATA_DIR = ".pantheon-recovery";
const RECOVERY_MANIFEST_PATH = `${RECOVERY_METADATA_DIR}/manifest.json`;
const RECOVERY_VERIFICATION_PATH = `${RECOVERY_METADATA_DIR}/restore-verification.json`;
const RECOVERY_HARD_LINK_KIND = "preventure_output_claim_v1";
const PREVENTURE_OUTPUT_ARTIFACT_SCHEMA = "pantheon.preventure-provider-output.v1";
const MAX_PREVENTURE_OUTPUT_MANIFEST_BYTES = 24 * 1024 * 1024;
const CREDENTIAL_STORE_FILENAME = "runtime-credentials.json";
const BACKUP_KINDS = new Set(["source", "database", "artifacts", "set", "file"]);
const LEGACY_SUPPORTED_SCHEMA_VERSIONS = Object.freeze([24, 25]);
const LAST_RELEASED_SCHEMA_VERSION = 26;
const CURRENT_ARCHIVE_SCHEMA_VERSION = 27;
const ARCHIVE_SCHEMA_COMPATIBILITY_LABELS = Object.freeze({
  24: "supported_legacy_24",
  25: "supported_legacy_25",
  [LAST_RELEASED_SCHEMA_VERSION]: "supported_last_release",
  [CURRENT_ARCHIVE_SCHEMA_VERSION]: "current_ready",
});
const SUPPORTED_ARCHIVE_SCHEMA_VERSIONS = new Set(
  Object.keys(ARCHIVE_SCHEMA_COMPATIBILITY_LABELS).map(Number),
);

if (LATEST_SCHEMA_VERSION !== CURRENT_ARCHIVE_SCHEMA_VERSION) {
  throw new Error(
    `Backup compatibility policy is defined through schema ${CURRENT_ARCHIVE_SCHEMA_VERSION}, `
    + `but the runtime is schema ${LATEST_SCHEMA_VERSION}.`,
  );
}

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

function backupKeyId(passphrase) {
  return `pbk-${crypto
    .createHash("sha256")
    .update("pantheon-backup-key-v1\0", "utf8")
    .update(requiredPassphrase(passphrase), "utf8")
    .digest("hex")
    .slice(0, 20)}`;
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
  if (header.keyId !== undefined && !/^pbk-[a-f0-9]{20}$/i.test(String(header.keyId))) {
    throw new Error("Invalid backup key identifier.");
  }
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
    keyId: backupKeyId(passphrase),
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
  const result = spawnSync(tarExecutable(), args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5 * 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error("Archive command exceeded its five-minute deadline.");
  }
  if (result.error) throw result.error;
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
    ".venv-renderer", "*/.venv-renderer",
    "tmp", "output", "backups", "data", "private", "*/private", RECOVERY_METADATA_DIR,
  ]);
  const managedPaths = [
    { candidate: options.artifactRoot, sqlite: false },
    { candidate: options.dbPath, sqlite: true },
    { candidate: options.backupDestination, sqlite: false },
    { candidate: options.approvalPackRoot, sqlite: false },
    { candidate: options.privateOperatorRoot, sqlite: false },
  ].filter((item) => item.candidate);
  for (const { candidate, sqlite } of managedPaths) {
    const relative = relativePathWithin(root, candidate);
    if (!relative) continue;
    if (relative === ".") throw new Error("Source backup root overlaps a runtime or backup destination.");
    excludes.add(relative);
    if (sqlite) {
      excludes.add(`${relative}-wal`);
      excludes.add(`${relative}-shm`);
    }
  }
  const args = ["-cf", archivePath, ...[...excludes].map((item) => `--exclude=${item}`), "-C", root, "."];
  runTar(args);
  return archivePath;
}

function copyDirectoryContents(source, destination, options = {}) {
  fs.mkdirSync(destination, { recursive: true });
  const excludedNames = new Set(options.excludedNames || []);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (excludedNames.has(entry.name)) continue;
    if (entry.isSymbolicLink()) {
      throw new Error(`Managed backup data cannot contain symbolic links: ${path.join(source, entry.name)}`);
    }
    fs.cpSync(path.join(source, entry.name), path.join(destination, entry.name), {
      recursive: true,
      dereference: false,
      force: false,
      errorOnExist: true,
      filter: (sourcePath) => {
        if (excludedNames.has(path.basename(sourcePath))) return false;
        if (fs.lstatSync(sourcePath).isSymbolicLink()) {
          throw new Error(`Managed backup data cannot contain symbolic links: ${sourcePath}`);
        }
        return true;
      },
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
      if (discoverPreventureOutputPairs(artifactRoot).length) {
        throw new Error(
          "Retained provider-output custody requires a full recovery-set backup with its database and hard-link map.",
        );
      }
      copyDirectoryContents(artifactRoot, path.join(stageRoot, "artifact-root"), {
        excludedNames: [CREDENTIAL_STORE_FILENAME],
      });
      included.push("artifact-root");
    }
    const packsAreInsideArtifacts = relativePathWithin(artifactRoot, approvalPackRoot) !== null;
    if (fs.existsSync(approvalPackRoot) && !packsAreInsideArtifacts) {
      copyDirectoryContents(approvalPackRoot, path.join(stageRoot, "approval-packs"), {
        excludedNames: [CREDENTIAL_STORE_FILENAME],
      });
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

function sqliteIntegrityProof(db) {
  const quick = db.prepare("PRAGMA quick_check").all();
  const integrity = db.prepare("PRAGMA integrity_check").all();
  const foreignKeys = db.prepare("PRAGMA foreign_key_check").all();
  const quickOk = quick.length === 1 && Object.values(quick[0])[0] === "ok";
  const integrityOk = integrity.length === 1 && Object.values(integrity[0])[0] === "ok";
  if (!quickOk || !integrityOk || foreignKeys.length) {
    throw new Error(
      `SQLite validation failed (quick=${quickOk}, integrity=${integrityOk}, foreignKeys=${foreignKeys.length}).`,
    );
  }
  return {
    quickCheck: "ok",
    integrityCheck: "ok",
    foreignKeyViolations: 0,
  };
}

function archiveSchemaVersion(db) {
  const table = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
  ).get();
  if (!table) throw new Error("Pantheon schema_migrations is missing.");
  const rows = db.prepare("SELECT version FROM schema_migrations ORDER BY version").all();
  if (
    !rows.length
    || rows.some((row, index) => Number(row.version) !== index + 1)
  ) {
    throw new Error("Pantheon schema migration history is incomplete or non-contiguous.");
  }
  return Number(rows.at(-1).version);
}

function proveDisposableDatabaseMigration(dbPath, fromVersion, sourceSha256) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-db-migration-proof-"));
  const disposablePath = path.join(workRoot, "runtime.sqlite");
  let migrated;
  try {
    fs.copyFileSync(dbPath, disposablePath, fs.constants.COPYFILE_EXCL);
    const db = openDatabase(disposablePath);
    try {
      migrated = verifyDatabase(db);
    } finally {
      db.close();
    }
    if (sha256File(dbPath) !== sourceSha256) {
      throw new Error("Source archive changed while its disposable migration was being proved.");
    }
    return {
      completed: true,
      sourceUnchanged: true,
      fromSchemaVersion: fromVersion,
      toSchemaVersion: migrated.schemaVersion,
      openedWith: "openDatabase",
    };
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function validateSqliteDatabase(dbPath) {
  const sourcePath = path.resolve(dbPath);
  const sourceSha256 = sha256File(sourcePath);
  let db;
  let integrity;
  let schemaVersion;
  let currentProof = null;
  try {
    db = new DatabaseSync(sourcePath, { readOnly: true });
    integrity = sqliteIntegrityProof(db);
    schemaVersion = archiveSchemaVersion(db);
    if (!SUPPORTED_ARCHIVE_SCHEMA_VERSIONS.has(schemaVersion)) {
      const supported = [...SUPPORTED_ARCHIVE_SCHEMA_VERSIONS]
        .sort((left, right) => left - right)
        .join(", ");
      throw new Error(
        `Runtime schema ${schemaVersion} is not a supported archive schema (${supported}).`,
      );
    }
    if (schemaVersion === CURRENT_ARCHIVE_SCHEMA_VERSION) currentProof = verifyDatabase(db);
  } catch (error) {
    throw new Error(`Database backup is not a valid, compatible Pantheon database: ${error.message}`);
  } finally {
    if (db) db.close();
  }
  try {
    const migrationProof = schemaVersion < CURRENT_ARCHIVE_SCHEMA_VERSION
      ? proveDisposableDatabaseMigration(sourcePath, schemaVersion, sourceSha256)
      : null;
    if (sha256File(sourcePath) !== sourceSha256) {
      throw new Error("Database archive changed during compatibility validation.");
    }
    return {
      ...integrity,
      schemaVersion,
      archiveSchemaVersion: schemaVersion,
      currentSchemaVersion: CURRENT_ARCHIVE_SCHEMA_VERSION,
      compatibility: ARCHIVE_SCHEMA_COMPATIBILITY_LABELS[schemaVersion],
      currentReady: Boolean(currentProof),
      migrationRequired: !currentProof,
      migrationProof,
      sourceSha256,
      sourceUnchanged: true,
    };
  } catch (error) {
    throw new Error(`Database backup is not a valid, compatible Pantheon database: ${error.message}`);
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

function readRequiredRecoveryJson(filePath, label) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Recovery source ${label} is not valid JSON: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Recovery source ${label} must contain a JSON object.`);
  }
  return value;
}

function dependencyMapsMatch(left = {}, right = {}) {
  return JSON.stringify(Object.entries(left).sort(([a], [b]) => a.localeCompare(b)))
    === JSON.stringify(Object.entries(right).sort(([a], [b]) => a.localeCompare(b)));
}

function configuredStartPath(packageJson) {
  const command = String(packageJson?.scripts?.start || "").trim();
  const match = command.match(/^node(?:\.exe)?\s+(?:"([^"]+)"|'([^']+)'|([^\s]+))$/i);
  const suppliedPath = String(match?.[1] || match?.[2] || match?.[3] || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  if (
    !match
    || !isSafeRelativeArchivePath(suppliedPath)
    || /[;&|<>]/.test(suppliedPath)
    || ![".js", ".cjs", ".mjs"].includes(path.posix.extname(suppliedPath).toLowerCase())
  ) {
    throw new Error(
      "Recovery source package.json must configure one safe `node <relative-entrypoint>` start command.",
    );
  }
  return {
    command,
    path: path.posix.normalize(suppliedPath),
  };
}

function validateRecoverySourceBundle(restoredRoot) {
  const root = path.resolve(restoredRoot);
  const packagePath = path.join(root, "package.json");
  const lockPath = path.join(root, "package-lock.json");
  for (const [relativePath, absolutePath] of [
    ["package.json", packagePath],
    ["package-lock.json", lockPath],
    ["src/server.js", path.join(root, "src", "server.js")],
    ["public/index.html", path.join(root, "public", "index.html")],
    ["public/app.js", path.join(root, "public", "app.js")],
    ["public/styles.css", path.join(root, "public", "styles.css")],
    ["requirements-runtime.txt", path.join(root, "requirements-runtime.txt")],
    ["requirements-renderer-lock.txt", path.join(root, "requirements-renderer-lock.txt")],
    ["scripts/renderer-environment.js", path.join(root, "scripts", "renderer-environment.js")],
    ["src/runtime/renderer-environment.js", path.join(root, "src", "runtime", "renderer-environment.js")],
    ["scripts/compose-storefront-cover.py", path.join(root, "scripts", "compose-storefront-cover.py")],
    ["scripts/render-approval-pack.py", path.join(root, "scripts", "render-approval-pack.py")],
    ["scripts/render-digital-product-kit.py", path.join(root, "scripts", "render-digital-product-kit.py")],
  ]) {
    if (
      !fs.existsSync(absolutePath)
      || !fs.lstatSync(absolutePath).isFile()
      || fs.lstatSync(absolutePath).isSymbolicLink()
    ) {
      throw new Error(`Recovery source is missing required file ${relativePath}.`);
    }
  }
  const packageJson = readRequiredRecoveryJson(packagePath, "package.json");
  const lock = readRequiredRecoveryJson(lockPath, "package-lock.json");
  const requiredRendererScripts = {
    "renderer:bootstrap": "node scripts/renderer-environment.js bootstrap",
    "renderer:check": "node scripts/renderer-environment.js check",
  };
  const invalidRendererScripts = Object.entries(requiredRendererScripts)
    .filter(([name, command]) => packageJson.scripts?.[name] !== command)
    .map(([name]) => name);
  if (invalidRendererScripts.length) {
    throw new Error(
      `Recovery source package.json must expose exact renderer scripts (${invalidRendererScripts.join(", ")}).`,
    );
  }
  const start = configuredStartPath(packageJson);
  const startPath = path.resolve(root, ...start.path.split("/"));
  if (
    relativePathWithin(root, startPath) !== start.path
    || !fs.existsSync(startPath)
    || !fs.lstatSync(startPath).isFile()
    || fs.lstatSync(startPath).isSymbolicLink()
  ) {
    throw new Error(`Recovery source is missing its configured start path ${start.path}.`);
  }
  const lockedRoot = lock.packages?.[""];
  const declaredDependencies = {
    dependencies: packageJson.dependencies || {},
    devDependencies: packageJson.devDependencies || {},
  };
  const lockedDependencies = {
    dependencies: lockedRoot?.dependencies || {},
    devDependencies: lockedRoot?.devDependencies || {},
  };
  if (
    !Number.isInteger(Number(lock.lockfileVersion))
    || Number(lock.lockfileVersion) < 2
    || !lockedRoot
    || packageJson.name !== lock.name
    || packageJson.version !== lock.version
    || packageJson.name !== lockedRoot.name
    || packageJson.version !== lockedRoot.version
  ) {
    throw new Error("Recovery source package-lock.json does not match package.json root metadata.");
  }
  if (
    !dependencyMapsMatch(declaredDependencies.dependencies, lockedDependencies.dependencies)
    || !dependencyMapsMatch(declaredDependencies.devDependencies, lockedDependencies.devDependencies)
  ) {
    throw new Error("Recovery source package-lock.json does not match package.json dependency metadata.");
  }
  const missingLockedPackages = Object.keys({
    ...declaredDependencies.dependencies,
    ...declaredDependencies.devDependencies,
  }).filter((name) => !String(lock.packages?.[`node_modules/${name}`]?.version || ""));
  if (missingLockedPackages.length) {
    throw new Error(
      `Recovery source package-lock.json is missing ${missingLockedPackages.length} declared package record(s).`,
    );
  }
  return {
    packageName: String(packageJson.name),
    packageVersion: String(packageJson.version),
    dependencyCount: Object.keys(declaredDependencies.dependencies).length,
    developmentDependencyCount: Object.keys(declaredDependencies.devDependencies).length,
    startCommand: start.command,
    startPath: start.path,
    requiredFiles: [...new Set([
      "package.json",
      "package-lock.json",
      "public/app.js",
      "public/index.html",
      "public/styles.css",
      "requirements-renderer-lock.txt",
      "requirements-runtime.txt",
      "scripts/renderer-environment.js",
      "scripts/compose-storefront-cover.py",
      "scripts/render-approval-pack.py",
      "scripts/render-digital-product-kit.py",
      "src/server.js",
      "src/runtime/renderer-environment.js",
      start.path,
    ])].sort(),
  };
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

function outputClaimPathParts(relativePath) {
  const normalized = toArchivePath(relativePath);
  if (!isSafeRelativeArchivePath(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.length < 3 || parts.at(-3) !== "claims") return null;
  const shard = parts.at(-2);
  const match = /^([a-f0-9]{64})\.json$/.exec(parts.at(-1));
  if (!match || shard !== match[1].slice(0, 2)) return null;
  return {
    storePrefix: parts.slice(0, -3).join("/"),
    identityHex: match[1],
  };
}

function outputContentPathParts(relativePath) {
  const normalized = toArchivePath(relativePath);
  if (!isSafeRelativeArchivePath(normalized)) return null;
  const parts = normalized.split("/");
  if (parts.length < 2 || parts.at(-3) === "claims") return null;
  const shard = parts.at(-2);
  const match = /^([a-f0-9]{64})\.json$/.exec(parts.at(-1));
  if (!match || shard !== match[1].slice(0, 2)) return null;
  return {
    storePrefix: parts.slice(0, -2).join("/"),
    artifactHex: match[1],
  };
}

function safeRecoveryFile(root, relativePath, label) {
  if (!isSafeRelativeArchivePath(relativePath)) {
    throw new Error(`${label} has an unsafe relative path.`);
  }
  const base = path.resolve(root);
  const filePath = path.resolve(base, ...toArchivePath(relativePath).split("/"));
  const relative = path.relative(base, filePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} escaped its recovery root.`);
  }
  const stats = fs.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular non-symbolic file.`);
  }
  return { filePath, stats };
}

function readOutputArtifactRecord(filePath, label, optional = false) {
  const stats = fs.lstatSync(filePath);
  if (
    !stats.isFile()
    || stats.isSymbolicLink()
    || stats.size < 2
    || stats.size > MAX_PREVENTURE_OUTPUT_MANIFEST_BYTES
  ) {
    if (optional) return null;
    throw new Error(`${label} has invalid retained-output manifest bytes.`);
  }
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      if (optional) return null;
      throw new Error("not an object");
    }
    return value;
  } catch {
    if (optional) return null;
    throw new Error(`${label} is not a valid retained-output manifest.`);
  }
}

function validateOutputArtifactRecord(record, expectedArtifactHex, expectedIdentityHex, label) {
  const hashPattern = /^sha256:[a-f0-9]{64}$/;
  if (
    record.schema !== PREVENTURE_OUTPUT_ARTIFACT_SCHEMA
    || !hashPattern.test(String(record.artifactHash || ""))
    || !hashPattern.test(String(record.authorityHash || ""))
    || !hashPattern.test(String(record.assignmentHash || ""))
    || !hashPattern.test(String(record.descriptorHash || ""))
    || !hashPattern.test(String(record.requestBodyHash || ""))
    || record.retained !== true
    || !Number.isFinite(Date.parse(record.retainedAt))
    || new Date(record.retainedAt).toISOString() !== record.retainedAt
  ) {
    throw new Error(`${label} has invalid immutable retained-output identity.`);
  }
  const artifactHex = record.artifactHash.slice("sha256:".length);
  const artifactRef = `preventure-output:${artifactHex}`;
  if (
    (expectedArtifactHex && artifactHex !== expectedArtifactHex)
    || record.artifactRef !== artifactRef
    || record.location !== artifactRef
  ) {
    throw new Error(`${label} changed its immutable retained-output reference.`);
  }
  const identityHash = sha256Value({
    schema: PREVENTURE_OUTPUT_ARTIFACT_SCHEMA,
    authorityHash: record.authorityHash,
    assignmentHash: record.assignmentHash,
    descriptorHash: record.descriptorHash,
    requestBodyHash: record.requestBodyHash,
  });
  if (expectedIdentityHex && identityHash !== `sha256:${expectedIdentityHex}`) {
    throw new Error(`${label} changed its canonical claim identity.`);
  }
  const {
    artifactHash: _artifactHash,
    artifactRef: _artifactRef,
    location: _location,
    retained: _retained,
    retainedAt,
    ...semantic
  } = record;
  if (record.artifactHash !== sha256Value({ ...semantic, retainedAt })) {
    throw new Error(`${label} changed its immutable retained-output manifest hash.`);
  }
  let rawProviderBytes;
  try {
    rawProviderBytes = Buffer.from(String(record.rawProviderBodyBase64 || ""), "base64");
  } catch {
    throw new Error(`${label} has invalid raw provider bytes.`);
  }
  const rawProviderBody = rawProviderBytes.toString("utf8");
  if (
    rawProviderBytes.length !== record.rawProviderBodyByteLength
    || rawProviderBytes.toString("base64") !== record.rawProviderBodyBase64
    || !Buffer.from(rawProviderBody, "utf8").equals(rawProviderBytes)
    || record.rawProviderBytesHash !== sha256Value(rawProviderBytes)
    || record.rawProviderBodyHash !== sha256Value(rawProviderBody)
    || record.providerResponseHash !== (
      record.providerResponse === null ? null : sha256Value(record.providerResponse)
    )
    || record.outputHash !== sha256Value(record.output ?? null)
    || record.groundedSourceSetHash !== sha256Value(record.groundedSources)
    || record.billingHash !== sha256Value(record.billing)
    || record.responseMetadataHash !== sha256Value(record.responseMetadata)
    || !Number.isSafeInteger(record.assignmentMaxCostAudCents)
    || record.assignmentMaxCostAudCents < 1
  ) {
    throw new Error(`${label} changed its exact raw, derived, or assignment-cap truth.`);
  }
  return {
    artifactHex,
    identityHex: identityHash.slice("sha256:".length),
    assignmentHash: record.assignmentHash,
    assignmentMaxCostAudCents: record.assignmentMaxCostAudCents,
    authorityHash: record.authorityHash,
    descriptorHash: record.descriptorHash,
    rawProviderBytesHash: record.rawProviderBytesHash,
  };
}

function discoverPreventureOutputPairs(artifactRoot) {
  if (!fs.existsSync(artifactRoot)) return [];
  const rootStats = fs.lstatSync(artifactRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("The managed artifact root is linked or is not a directory.");
  }
  const inventory = inventoryDirectory(artifactRoot, { excludePrefixes: [] });
  const byPath = new Map(inventory.map((item) => [item.path, item]));
  const pairs = [];
  const claimedContentPaths = new Set();

  for (const claimEntry of inventory) {
    const claimParts = outputClaimPathParts(claimEntry.path);
    if (!claimParts) continue;
    const claim = safeRecoveryFile(artifactRoot, claimEntry.path, "Retained-output claim");
    const record = readOutputArtifactRecord(
      claim.filePath,
      `Retained-output claim ${claimEntry.path}`,
    );
    const identity = validateOutputArtifactRecord(
      record,
      null,
      claimParts.identityHex,
      `Retained-output claim ${claimEntry.path}`,
    );
    if (claimParts.storePrefix !== "preventure-research") {
      throw new Error(`Retained-output claim ${claimEntry.path} is outside its canonical store root.`);
    }
    const contentRelativePath = [
      claimParts.storePrefix,
      identity.artifactHex.slice(0, 2),
      `${identity.artifactHex}.json`,
    ].filter(Boolean).join("/");
    const contentEntry = byPath.get(contentRelativePath);
    if (!contentEntry) {
      throw new Error(`Retained-output claim ${claimEntry.path} is missing its exact content file.`);
    }
    const content = safeRecoveryFile(
      artifactRoot,
      contentRelativePath,
      "Retained-output content",
    );
    const contentRecord = readOutputArtifactRecord(
      content.filePath,
      `Retained-output content ${contentRelativePath}`,
    );
    validateOutputArtifactRecord(
      contentRecord,
      identity.artifactHex,
      claimParts.identityHex,
      `Retained-output content ${contentRelativePath}`,
    );
    if (
      contentEntry.bytes !== claimEntry.bytes
      || contentEntry.sha256 !== claimEntry.sha256
      || !fs.readFileSync(content.filePath).equals(fs.readFileSync(claim.filePath))
      || JSON.stringify(contentRecord) !== JSON.stringify(record)
    ) {
      throw new Error(`Retained-output claim ${claimEntry.path} and its content bytes disagree.`);
    }
    if (claimedContentPaths.has(contentRelativePath)) {
      throw new Error(`Retained-output content ${contentRelativePath} has more than one claim.`);
    }
    claimedContentPaths.add(contentRelativePath);
    pairs.push({
      contentRelativePath,
      claimRelativePath: claimEntry.path,
      record,
      artifactHash: record.artifactHash,
      identityHash: `sha256:${claimParts.identityHex}`,
      assignmentHash: identity.assignmentHash,
      assignmentMaxCostAudCents: identity.assignmentMaxCostAudCents,
      authorityHash: identity.authorityHash,
      descriptorHash: identity.descriptorHash,
      rawProviderBytesHash: identity.rawProviderBytesHash,
      bytes: contentEntry.bytes,
      sha256: contentEntry.sha256,
    });
  }

  for (const entry of inventory) {
    const contentParts = outputContentPathParts(entry.path);
    if (!contentParts) continue;
    const file = safeRecoveryFile(artifactRoot, entry.path, "Retained-output content candidate");
    const record = readOutputArtifactRecord(file.filePath, "Retained-output content candidate", true);
    if (record?.schema !== PREVENTURE_OUTPUT_ARTIFACT_SCHEMA) continue;
    const identity = validateOutputArtifactRecord(
      record,
      contentParts.artifactHex,
      null,
      `Retained-output content ${entry.path}`,
    );
    if (contentParts.storePrefix !== "preventure-research") {
      throw new Error(`Retained-output content ${entry.path} is outside its canonical store root.`);
    }
    if (!claimedContentPaths.has(entry.path)) {
      throw new Error(`Retained-output content ${entry.path} is missing its canonical claim.`);
    }
  }

  return pairs.sort((left, right) => left.claimRelativePath.localeCompare(right.claimRelativePath));
}

function outputAssignmentCaps(dbPath, pairs) {
  if (!pairs.length) return new Map();
  let db;
  try {
    db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
    const caps = new Map();
    for (const pair of pairs) {
      const row = db.prepare(
        `SELECT authority_hash, max_cost_aud_cents
         FROM preventure_research_assignments WHERE assignment_hash = ?`,
      ).get(pair.assignmentHash);
      if (
        !row
        || row.authority_hash !== pair.authorityHash
        || row.max_cost_aud_cents !== pair.assignmentMaxCostAudCents
      ) {
        throw new Error(
          `Retained-output artifact ${pair.artifactHash} changed its database assignment cap.`,
        );
      }
      caps.set(pair.assignmentHash, row.max_cost_aud_cents);
    }
    return caps;
  } finally {
    if (db) db.close();
  }
}

function validateTerminalRecoveryCustody(dbPath, pairs) {
  let db;
  try {
    db = new DatabaseSync(path.resolve(dbPath), { readOnly: true });
    const table = db.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = 'preventure_research_terminal_recoveries'`,
    ).get();
    if (!table) return 0;
    const rows = db.prepare(
      `SELECT authority_hash, assignment_hash, assignment_cap_aud_cents,
              descriptor_hash, request_body_hash, artifact_hash, artifact_ref,
              artifact_kind, retained_at, provider_response_hash,
              raw_provider_body_hash, raw_provider_bytes_hash, output_hash,
              grounded_source_set_hash, billing_hash, response_metadata_hash
       FROM preventure_research_terminal_recoveries ORDER BY recovery_hash`,
    ).all();
    const byArtifactHash = new Map(pairs.map((pair) => [pair.artifactHash, pair]));
    for (const row of rows) {
      const pair = byArtifactHash.get(row.artifact_hash);
      const record = pair?.record;
      if (
        !pair
        || !record
        || row.artifact_ref !== `preventure-output:${row.artifact_hash.slice("sha256:".length)}`
        || record.artifactRef !== row.artifact_ref
        || record.authorityHash !== row.authority_hash
        || record.assignmentHash !== row.assignment_hash
        || record.assignmentMaxCostAudCents !== row.assignment_cap_aud_cents
        || record.descriptorHash !== row.descriptor_hash
        || record.requestBodyHash !== row.request_body_hash
        || record.artifactKind !== row.artifact_kind
        || record.retainedAt !== row.retained_at
        || (record.providerResponseHash ?? null) !== row.provider_response_hash
        || record.rawProviderBodyHash !== row.raw_provider_body_hash
        || record.rawProviderBytesHash !== row.raw_provider_bytes_hash
        || record.outputHash !== row.output_hash
        || record.groundedSourceSetHash !== row.grounded_source_set_hash
        || record.billingHash !== row.billing_hash
        || record.responseMetadataHash !== row.response_metadata_hash
      ) {
        throw new Error(
          `Terminal retained-output recovery ${row.artifact_hash} is missing or changed.`,
        );
      }
    }
    return rows.length;
  } finally {
    if (db) db.close();
  }
}

function validateLinkedOutputStore(artifactRoot, dbPath, pairs) {
  if (!pairs.length) return;
  const caps = outputAssignmentCaps(dbPath, pairs);
  const {
    createPreventureResearchOutputStore,
  } = require("./preventure-research-output-store");
  const store = createPreventureResearchOutputStore({
    artifactRoot: path.join(path.resolve(artifactRoot), "preventure-research"),
    assignmentMaxCostAudCentsForHash(assignmentHash) {
      if (!caps.has(assignmentHash)) {
        throw new Error("The retained-output assignment cap is unavailable.");
      }
      return caps.get(assignmentHash);
    },
  });
  for (const pair of pairs) {
    const loaded = store.load({
      retainedOutputHash: `preventure-output:${pair.artifactHash.slice("sha256:".length)}`,
      authorityHash: pair.authorityHash,
      assignmentHash: pair.assignmentHash,
      descriptorHash: pair.descriptorHash,
    });
    if (
      loaded.artifactHash !== pair.artifactHash
      || loaded.rawProviderBytesHash !== pair.rawProviderBytesHash
      || loaded.assignmentMaxCostAudCents !== pair.assignmentMaxCostAudCents
    ) {
      throw new Error(`Retained-output artifact ${pair.artifactHash} failed semantic reload.`);
    }
  }
}

function collectRecoveryHardLinks(artifactRoot, dbPath) {
  const pairs = discoverPreventureOutputPairs(artifactRoot);
  validateLinkedOutputStore(artifactRoot, dbPath, pairs);
  validateTerminalRecoveryCustody(dbPath, pairs);
  return pairs.map((pair) => {
    const content = safeRecoveryFile(
      artifactRoot,
      pair.contentRelativePath,
      "Retained-output content",
    );
    const claim = safeRecoveryFile(
      artifactRoot,
      pair.claimRelativePath,
      "Retained-output claim",
    );
    if (
      content.stats.dev !== claim.stats.dev
      || content.stats.ino !== claim.stats.ino
      || content.stats.nlink !== 2
      || claim.stats.nlink !== 2
    ) {
      throw new Error(
        `Retained-output claim ${pair.claimRelativePath} is not its one exact content hard link.`,
      );
    }
    return {
      kind: RECOVERY_HARD_LINK_KIND,
      contentPath: `data/artifacts/${pair.contentRelativePath}`,
      claimPath: `data/artifacts/${pair.claimRelativePath}`,
      artifactHash: pair.artifactHash,
      identityHash: pair.identityHash,
      assignmentHash: pair.assignmentHash,
      assignmentMaxCostAudCents: pair.assignmentMaxCostAudCents,
      authorityHash: pair.authorityHash,
      descriptorHash: pair.descriptorHash,
      rawProviderBytesHash: pair.rawProviderBytesHash,
      bytes: pair.bytes,
      sha256: pair.sha256,
    };
  });
}

function syncRecoveryDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (!["EPERM", "EINVAL", "EBADF", "ENOTSUP"].includes(error?.code)) throw error;
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function syncRecoveryFile(filePath) {
  let descriptor;
  try {
    descriptor = fs.openSync(filePath, fs.constants.O_RDWR);
    fs.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch {}
    }
  }
}

function validateRecoveryHardLinks(root, manifest, actualInventory, options = {}) {
  const records = manifest.hardLinks === undefined ? [] : manifest.hardLinks;
  if (!Array.isArray(records) || records.length > 10_000) {
    throw new Error("Recovery-set hard-link map is invalid.");
  }
  const artifactRoot = path.join(path.resolve(root), "data", "artifacts");
  const discoveredPairs = discoverPreventureOutputPairs(artifactRoot);
  const recoveredDbPath = path.join(path.resolve(root), "data", "runtime.sqlite");
  outputAssignmentCaps(recoveredDbPath, discoveredPairs);
  const terminalCustodyCount = validateTerminalRecoveryCustody(
    recoveredDbPath,
    discoveredPairs,
  );
  const discovered = discoveredPairs.map((pair) => ({
    kind: RECOVERY_HARD_LINK_KIND,
    contentPath: `data/artifacts/${pair.contentRelativePath}`,
    claimPath: `data/artifacts/${pair.claimRelativePath}`,
    artifactHash: pair.artifactHash,
    identityHash: pair.identityHash,
    assignmentHash: pair.assignmentHash,
    assignmentMaxCostAudCents: pair.assignmentMaxCostAudCents,
    authorityHash: pair.authorityHash,
    descriptorHash: pair.descriptorHash,
    rawProviderBytesHash: pair.rawProviderBytesHash,
    bytes: pair.bytes,
    sha256: pair.sha256,
  }));
  const expectedKeys = [
    "artifactHash", "assignmentHash", "assignmentMaxCostAudCents", "authorityHash", "bytes",
    "claimPath", "contentPath", "descriptorHash", "identityHash", "kind",
    "rawProviderBytesHash", "sha256",
  ].sort();
  const seenPaths = new Set();
  const inventoryByPath = new Map(actualInventory.map((item) => [item.path, item]));
  for (const record of records) {
    if (
      !record
      || typeof record !== "object"
      || Array.isArray(record)
      || JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(expectedKeys)
      || record.kind !== RECOVERY_HARD_LINK_KIND
      || !/^sha256:[a-f0-9]{64}$/.test(record.artifactHash)
      || !/^sha256:[a-f0-9]{64}$/.test(record.assignmentHash)
      || !Number.isSafeInteger(record.assignmentMaxCostAudCents)
      || record.assignmentMaxCostAudCents < 1
      || !/^sha256:[a-f0-9]{64}$/.test(record.authorityHash)
      || !/^sha256:[a-f0-9]{64}$/.test(record.descriptorHash)
      || !/^sha256:[a-f0-9]{64}$/.test(record.identityHash)
      || !/^sha256:[a-f0-9]{64}$/.test(record.rawProviderBytesHash)
      || !Number.isSafeInteger(record.bytes)
      || record.bytes < 2
      || !/^[a-f0-9]{64}$/.test(record.sha256)
      || !isSafeRelativeArchivePath(record.contentPath)
      || !isSafeRelativeArchivePath(record.claimPath)
      || !record.contentPath.startsWith("data/artifacts/")
      || !record.claimPath.startsWith("data/artifacts/")
      || seenPaths.has(record.contentPath)
      || seenPaths.has(record.claimPath)
    ) {
      throw new Error("Recovery-set hard-link map contains an invalid entry.");
    }
    seenPaths.add(record.contentPath);
    seenPaths.add(record.claimPath);
    for (const linkedPath of [record.contentPath, record.claimPath]) {
      const inventory = inventoryByPath.get(linkedPath);
      if (
        !inventory
        || inventory.bytes !== record.bytes
        || inventory.sha256 !== record.sha256
        || inventory.component !== "runtimeArtifacts"
      ) {
        throw new Error(`Recovery-set hard-link inventory changed: ${linkedPath}`);
      }
    }
  }
  const normalizedRecords = [...records]
    .sort((left, right) => left.claimPath.localeCompare(right.claimPath));
  if (JSON.stringify(normalizedRecords) !== JSON.stringify(discovered)) {
    throw new Error("Recovery-set hard-link map does not match its retained-output claims.");
  }

  for (const record of normalizedRecords) {
    const content = safeRecoveryFile(root, record.contentPath, "Recovery hard-link content");
    const claim = safeRecoveryFile(root, record.claimPath, "Recovery hard-link claim");
    const linked = content.stats.dev === claim.stats.dev
      && content.stats.ino === claim.stats.ino
      && content.stats.nlink === 2
      && claim.stats.nlink === 2;
    if (!linked && options.reconstruct !== true) {
      if (options.allowIndependent === true) continue;
      throw new Error(`Recovery-set retained-output claim is not linked: ${record.claimPath}`);
    }
    if (!linked) {
      syncRecoveryFile(content.filePath);
      fs.unlinkSync(claim.filePath);
      fs.linkSync(content.filePath, claim.filePath);
      syncRecoveryFile(content.filePath);
      syncRecoveryDirectory(path.dirname(claim.filePath));
    }
    const finalContent = safeRecoveryFile(root, record.contentPath, "Recovery hard-link content");
    const finalClaim = safeRecoveryFile(root, record.claimPath, "Recovery hard-link claim");
    if (
      finalContent.stats.dev !== finalClaim.stats.dev
      || finalContent.stats.ino !== finalClaim.stats.ino
      || finalContent.stats.nlink !== 2
      || finalClaim.stats.nlink !== 2
    ) {
      throw new Error(`Recovery-set retained-output hard link failed verification: ${record.claimPath}`);
    }
  }
  if (options.allowIndependent !== true) {
    validateLinkedOutputStore(artifactRoot, recoveredDbPath, discoveredPairs);
  }
  return { records: normalizedRecords, terminalCustodyCount };
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
      approvalPackRoot,
      privateOperatorRoot,
    });
    validateArchiveEntries(sourceArchive, "source");
    runTar(["-xf", sourceArchive, "-C", stageRoot]);
    const sourceContract = validateRecoverySourceBundle(stageRoot);

    const restoredDbPath = path.join(stageRoot, "data", "runtime.sqlite");
    await createDatabaseSnapshot(dbPath, restoredDbPath);

    const restoredArtifactRoot = path.join(stageRoot, "data", "artifacts");
    fs.mkdirSync(restoredArtifactRoot, { recursive: true });
    const artifactsPresent = fs.existsSync(artifactRoot);
    const hardLinks = artifactsPresent
      ? collectRecoveryHardLinks(artifactRoot, restoredDbPath)
      : [];
    if (artifactsPresent) {
      copyDirectoryContents(artifactRoot, restoredArtifactRoot, {
        excludedNames: [CREDENTIAL_STORE_FILENAME],
      });
    }

    const restoredPackRoot = path.join(stageRoot, "output", "pdf");
    fs.mkdirSync(restoredPackRoot, { recursive: true });
    const packsInsideArtifacts = pathsOverlap(artifactRoot, approvalPackRoot)
      && relativePathWithin(artifactRoot, approvalPackRoot) !== null;
    const approvalPacksPresent = fs.existsSync(approvalPackRoot) && !packsInsideArtifacts;
    if (approvalPacksPresent) {
      copyDirectoryContents(approvalPackRoot, restoredPackRoot, {
        excludedNames: [CREDENTIAL_STORE_FILENAME],
      });
    }

    const restoredPrivateRoot = path.join(stageRoot, "private");
    fs.mkdirSync(restoredPrivateRoot, { recursive: true });
    if (fs.existsSync(privateOperatorRoot)) {
      copyDirectoryContents(privateOperatorRoot, restoredPrivateRoot, {
        excludedNames: [CREDENTIAL_STORE_FILENAME],
      });
    }
    const privateOperatorReferencesPresent = fs.readdirSync(restoredPrivateRoot).length > 0;

    const inventory = inventoryDirectory(stageRoot);
    validateRecoveryHardLinks(stageRoot, { hardLinks }, inventory, {
      allowIndependent: true,
    });
    const components = {
      source: {
        required: true,
        present: true,
        restorePath: ".",
        bootContract: sourceContract,
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
      hardLinks,
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
  const sourceContract = validateRecoverySourceBundle(root);

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
    if (
      componentName === "source"
      && expected.bootContract !== undefined
      && JSON.stringify(expected.bootContract) !== JSON.stringify(sourceContract)
    ) {
      throw new Error("Recovery-set source startup contract does not match the restored files.");
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
  const hardLinkProof = validateRecoveryHardLinks(root, manifest, actualInventory, {
    reconstruct: options.reconstructHardLinks === true,
  });
  return {
    format: manifest.format,
    version: manifest.version,
    setId: manifest.setId,
    createdAt: manifest.createdAt,
    fileCount: actualInventory.length,
    bytes: actualInventory.reduce((sum, item) => sum + item.bytes, 0),
    components: manifest.components,
    hardLinkCount: hardLinkProof.records.length,
    terminalCustodyCount: hardLinkProof.terminalCustodyCount,
    source: sourceContract,
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
        approvalPackRoot: options.approvalPackRoot || preferredEnvironment("APPROVAL_PACK_DIR"),
        privateOperatorRoot: options.privateOperatorRoot || preferredEnvironment("PRIVATE_OPERATOR_DIR"),
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

function currentActiveRestoreConfiguration() {
  return {
    rootDir: path.resolve(CONFIG.rootDir),
    dbPath: path.resolve(CONFIG.dbPath),
    artifactRoot: path.resolve(CONFIG.artifactRoot),
    approvalPackRoot: path.resolve(
      preferredEnvironment("APPROVAL_PACK_DIR")
        || path.join(CONFIG.rootDir, "output", "pdf"),
    ),
    privateOperatorRoot: path.resolve(
      preferredEnvironment("PRIVATE_OPERATOR_DIR")
        || path.join(CONFIG.rootDir, "private"),
    ),
  };
}

function assertRestoreDestinationIsInactive(
  kind,
  destinationPath,
  activeConfiguration = currentActiveRestoreConfiguration(),
) {
  const destination = path.resolve(destinationPath);
  if (kind === "database" && pathsOverlap(destination, activeConfiguration.dbPath)) {
    throw new Error("Restore refused: destination is the active runtime database. Restore to a separate location, verify it, stop Pantheon, then perform a controlled swap.");
  }
  if (kind === "source" && pathsOverlap(destination, activeConfiguration.rootDir)) {
    throw new Error("Restore refused: destination overlaps the active source workspace.");
  }
  if (kind === "set") {
    const activeComponents = [
      ["source workspace", activeConfiguration.rootDir],
      ["runtime database", activeConfiguration.dbPath],
      ["runtime artifacts", activeConfiguration.artifactRoot],
      ["approval packs", activeConfiguration.approvalPackRoot],
      ["private operator references", activeConfiguration.privateOperatorRoot],
    ];
    const overlap = activeComponents.find(([, activePath]) => (
      activePath && pathsOverlap(destination, activePath)
    ));
    if (overlap) {
      throw new Error(
        `Restore refused: recovery-set destination overlaps active ${overlap[0]}.`,
      );
    }
  }
  if (kind === "artifacts") {
    if (
      pathsOverlap(destination, activeConfiguration.artifactRoot)
      || pathsOverlap(destination, activeConfiguration.approvalPackRoot)
    ) {
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
      const verification = validateRecoverySetDirectory(stagedPath, {
        header: proof,
        reconstructHardLinks: true,
      });
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
        restoredHardLinkCount: verification.hardLinkCount,
        restoredTerminalCustodyCount: verification.terminalCustodyCount,
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
        recoverySet: validateRecoverySetDirectory(extractedPath, {
          header: proof,
          reconstructHardLinks: true,
        }),
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

function verifyBackupForRetention(sourcePath, options = {}) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-retention-verify-"));
  const rawPath = path.join(workRoot, "payload");
  const extractedPath = path.join(workRoot, "extracted");
  try {
    const proof = decryptPayload(path.resolve(sourcePath), {
      passphrase: options.passphrase,
      destinationPath: rawPath,
    });
    if (proof.kind === "database") {
      validateSqliteDatabase(rawPath);
      return proof;
    }
    if (proof.kind === "file") return proof;
    if (!["source", "artifacts", "set"].includes(proof.kind)) {
      throw new Error(`Unsupported backup kind: ${proof.kind}`);
    }
    validateArchiveEntries(rawPath, proof.kind);
    fs.mkdirSync(extractedPath, { recursive: false });
    runTar(["-xf", rawPath, "-C", extractedPath]);
    if (proof.kind === "set") {
      validateRecoverySetDirectory(extractedPath, {
        header: proof,
        reconstructHardLinks: true,
      });
    } else {
      inventoryDirectory(extractedPath, { excludePrefixes: [] });
    }
    return proof;
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

function pruneBackups(destinationRoot = CONFIG.backupDestination, options = {}) {
  if (!fs.existsSync(destinationRoot)) return { kept: [], removed: [], pinned: [], invalid: [] };
  const dailyLimit = options.dailyLimit ?? 7;
  const weeklyLimit = options.weeklyLimit ?? 4;
  const candidates = fs.readdirSync(destinationRoot)
    .filter((name) => name.endsWith(".jbackup"))
    .map((name) => ({ filePath: path.join(destinationRoot, name), name }));
  const verified = [];
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
      const header = verifyBackupForRetention(file.filePath, { passphrase: options.passphrase });
      verified.push({ ...file, header, createdAt: new Date(header.createdAt) });
    } catch (error) {
      kept.push(file.filePath);
      invalid.push({ filePath: file.filePath, error: error.message });
    }
  }

  verified.sort((a, b) => b.createdAt - a.createdAt);
  const dailyKeys = new Map();
  const weeklyKeys = new Map();
  for (const file of verified) {
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
  ARCHIVE_SCHEMA_COMPATIBILITY_LABELS,
  CURRENT_ARCHIVE_SCHEMA_VERSION,
  LEGACY_SUPPORTED_SCHEMA_VERSIONS,
  LAST_RELEASED_SCHEMA_VERSION,
  assertRestoreDestinationIsInactive,
  authenticateEncryptedBackup,
  backupKeyId,
  createBackup,
  createArtifactArchive,
  createDatabaseSnapshot,
  createRecoverySetArchive,
  createSourceArchive,
  currentActiveRestoreConfiguration,
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
  validateRecoverySourceBundle,
  validateSqliteDatabase,
  verifyBackup,
};
