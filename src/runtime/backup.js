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
const BACKUP_KINDS = new Set(["source", "database", "artifacts", "file"]);

function requiredPassphrase(value = process.env.JARVIS_BACKUP_PASSPHRASE) {
  if (!value || value.length < 16) {
    throw new Error("JARVIS_BACKUP_PASSPHRASE must contain at least 16 characters.");
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
    "tmp", "output", "backups", "data",
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
      || process.env.JARVIS_APPROVAL_PACK_DIR
      || path.join(root, "output", "pdf"),
  );
  const stageRoot = fs.mkdtempSync(path.join(path.dirname(path.resolve(archivePath)), "jarvis-artifacts-stage-"));
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

async function createDatabaseSnapshot(dbPath, snapshotPath) {
  if (!fs.existsSync(dbPath)) throw new Error(`Runtime database does not exist: ${dbPath}`);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    await backup(db, snapshotPath);
  } finally {
    db.close();
  }
  validateSqliteDatabase(snapshotPath);
  return snapshotPath;
}

function listArchiveEntries(archivePath) {
  return runTar(["-tf", archivePath])
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
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
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-backup-"));
  const stampDate = options.createdAt ? new Date(options.createdAt) : new Date();
  if (!Number.isFinite(stampDate.getTime())) throw new Error("Backup creation time is invalid.");
  const stamp = timestampForFile(stampDate);
  const rawPath = path.join(workRoot, kind === "database" ? "runtime.sqlite" : `${kind}.tar`);
  const encryptedPath = path.join(destinationRoot, `jarvis-${kind}-${stamp}.jbackup`);
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
    } else {
      throw new Error(`Unsupported backup kind: ${kind}`);
    }
    const result = await encryptFile(rawPath, encryptedPath, {
      kind,
      passphrase: options.passphrase,
      createdAt: stampDate.toISOString(),
    });
    return { ...result, kind, sourceRoot, artifactRoot: kind === "artifacts" ? artifactRoot : undefined };
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
    throw new Error("Restore refused: destination is the active runtime database. Restore to a separate location, verify it, stop Jarvis, then perform a controlled swap.");
  }
  if (kind === "source" && pathsOverlap(destination, CONFIG.rootDir)) {
    throw new Error("Restore refused: destination overlaps the active source workspace.");
  }
  if (kind === "artifacts") {
    const activePackRoot = process.env.JARVIS_APPROVAL_PACK_DIR || path.join(CONFIG.rootDir, "output", "pdf");
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
  try {
    if (fs.existsSync(destination)) {
      fs.renameSync(destination, previousPath);
      movedPrevious = true;
    }
    fs.renameSync(stagedPath, destination);
    if (movedPrevious) fs.rmSync(previousPath, { recursive: true, force: true });
  } catch (error) {
    if (movedPrevious && !fs.existsSync(destination) && fs.existsSync(previousPath)) {
      fs.renameSync(previousPath, destination);
    }
    throw error;
  }
}

async function restoreBackup(sourcePath, destinationPath, options = {}) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-restore-"));
  const rawPath = path.join(workRoot, "payload");
  let stagedPath = null;
  try {
    const proof = await decryptFile(path.resolve(sourcePath), rawPath, options);
    const kind = proof.kind;
    if (!["source", "artifacts", "database"].includes(kind)) throw new Error(`Unsupported backup kind: ${kind}`);
    assertRestoreDestinationIsInactive(kind, destinationPath);

    const destination = path.resolve(destinationPath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    stagedPath = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.restore-${process.pid}-${crypto.randomBytes(6).toString("hex")}`,
    );
    if (kind === "database") {
      const sqliteProof = validateSqliteDatabase(rawPath);
      fs.copyFileSync(rawPath, stagedPath, fs.constants.COPYFILE_EXCL);
      validateSqliteDatabase(stagedPath);
      commitStagedRestore(stagedPath, destination, options);
      stagedPath = null;
      return { ...proof, destinationPath: destination, sqlite: sqliteProof };
    }

    validateArchiveEntries(rawPath, kind);
    fs.mkdirSync(stagedPath, { recursive: false });
    runTar(["-xf", rawPath, "-C", stagedPath]);
    commitStagedRestore(stagedPath, destination, options);
    stagedPath = null;
    return { ...proof, destinationPath: destination };
  } finally {
    if (stagedPath) fs.rmSync(stagedPath, { recursive: true, force: true });
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
  createSourceArchive,
  decryptFile,
  encryptFile,
  extractArchive,
  listArchiveEntries,
  pruneBackups,
  readEncryptedHeader,
  requiredPassphrase,
  restoreBackup,
  sha256File,
  validateArchiveEntries,
  validateSqliteDatabase,
};
