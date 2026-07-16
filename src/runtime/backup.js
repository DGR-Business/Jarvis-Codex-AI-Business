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

async function encryptFile(sourcePath, destinationPath, options = {}) {
  const passphrase = requiredPassphrase(options.passphrase);
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const header = {
    version: 1,
    algorithm: "aes-256-gcm",
    keyDerivation: "scrypt",
    createdAt: new Date().toISOString(),
    kind: options.kind || "file",
    payloadBytes: fs.statSync(sourcePath).size,
    payloadSha256: sha256File(sourcePath),
    salt: salt.toString("base64"),
    iv: iv.toString("base64"),
  };
  const headerBytes = Buffer.from(JSON.stringify(header), "utf8");
  const headerLength = Buffer.allocUnsafe(4);
  headerLength.writeUInt32BE(headerBytes.length);
  const key = crypto.scryptSync(passphrase, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(headerBytes);

  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.writeFileSync(destinationPath, Buffer.concat([MAGIC, headerLength, headerBytes]));
  await pipeline(
    fs.createReadStream(sourcePath),
    cipher,
    fs.createWriteStream(destinationPath, { flags: "a" }),
  );
  fs.appendFileSync(destinationPath, cipher.getAuthTag());
  return { ...header, destinationPath, backupSha256: sha256File(destinationPath) };
}

function readEncryptedHeader(filePath) {
  const fd = fs.openSync(filePath, "r");
  try {
    const prefix = Buffer.allocUnsafe(MAGIC.length + 4);
    fs.readSync(fd, prefix, 0, prefix.length, 0);
    if (!prefix.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error("Unsupported backup format.");
    }
    const headerLength = prefix.readUInt32BE(MAGIC.length);
    if (headerLength < 2 || headerLength > 64 * 1024) throw new Error("Invalid backup header.");
    const headerBytes = Buffer.allocUnsafe(headerLength);
    fs.readSync(fd, headerBytes, 0, headerLength, prefix.length);
    return {
      header: JSON.parse(headerBytes.toString("utf8")),
      headerBytes,
      payloadOffset: prefix.length + headerLength,
    };
  } finally {
    fs.closeSync(fd);
  }
}

async function decryptFile(sourcePath, destinationPath, options = {}) {
  const passphrase = requiredPassphrase(options.passphrase);
  const { header, headerBytes, payloadOffset } = readEncryptedHeader(sourcePath);
  const stats = fs.statSync(sourcePath);
  const payloadEnd = stats.size - AUTH_TAG_BYTES - 1;
  if (payloadEnd < payloadOffset) throw new Error("Backup payload is truncated.");
  const fd = fs.openSync(sourcePath, "r");
  const authTag = Buffer.allocUnsafe(AUTH_TAG_BYTES);
  try {
    fs.readSync(fd, authTag, 0, AUTH_TAG_BYTES, stats.size - AUTH_TAG_BYTES);
  } finally {
    fs.closeSync(fd);
  }
  const key = crypto.scryptSync(passphrase, Buffer.from(header.salt, "base64"), 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(header.iv, "base64"));
  decipher.setAAD(headerBytes);
  decipher.setAuthTag(authTag);
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  try {
    await pipeline(
      fs.createReadStream(sourcePath, { start: payloadOffset, end: payloadEnd }),
      decipher,
      fs.createWriteStream(destinationPath),
    );
  } catch (error) {
    fs.rmSync(destinationPath, { force: true });
    throw new Error(`Backup could not be decrypted or authenticated: ${error.message}`);
  }
  const restoredHash = sha256File(destinationPath);
  if (restoredHash !== header.payloadSha256) {
    fs.rmSync(destinationPath, { force: true });
    throw new Error("Restored backup hash does not match its authenticated manifest.");
  }
  return { ...header, restoredPath: destinationPath, restoredSha256: restoredHash };
}

function tarExecutable() {
  return process.platform === "win32" ? "tar.exe" : "tar";
}

function runTar(args) {
  const result = spawnSync(tarExecutable(), args, { encoding: "utf8", windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`Archive command failed: ${(result.stderr || result.stdout || "unknown error").trim()}`);
  }
}

function createSourceArchive(sourceRoot, archivePath) {
  const excludes = [
    ".git", "*/.git", "node_modules", "*/node_modules", ".playwright-cli",
    "tmp", "output", "backups", "data/*.sqlite", "data/*.sqlite-shm", "data/*.sqlite-wal",
  ];
  const args = ["-cf", archivePath, ...excludes.map((item) => `--exclude=${item}`), "-C", sourceRoot, "."];
  runTar(args);
  return archivePath;
}

function createArtifactArchive(sourceRoot, archivePath) {
  const entries = ["data", "deliverables", "output"].filter((entry) => fs.existsSync(path.join(sourceRoot, entry)));
  if (!entries.length) throw new Error("No runtime artifact directories exist to back up.");
  runTar(["-cf", archivePath, "-C", sourceRoot, ...entries]);
  return archivePath;
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
  return snapshotPath;
}

function extractArchive(archivePath, destinationRoot) {
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
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-backup-"));
  const stamp = timestampForFile();
  const rawPath = path.join(workRoot, kind === "database" ? "runtime.sqlite" : `${kind}.tar`);
  const encryptedPath = path.join(destinationRoot, `jarvis-${kind}-${stamp}.jbackup`);
  try {
    if (kind === "database") {
      await createDatabaseSnapshot(path.resolve(options.dbPath || CONFIG.dbPath), rawPath);
    } else if (kind === "source") {
      createSourceArchive(sourceRoot, rawPath);
    } else if (kind === "artifacts") {
      createArtifactArchive(sourceRoot, rawPath);
    } else {
      throw new Error(`Unsupported backup kind: ${kind}`);
    }
    const result = await encryptFile(rawPath, encryptedPath, { kind, passphrase: options.passphrase });
    return { ...result, kind, sourceRoot };
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

async function restoreBackup(sourcePath, destinationPath, options = {}) {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "jarvis-restore-"));
  const { header } = readEncryptedHeader(sourcePath);
  const rawPath = path.join(workRoot, header.kind === "database" ? "runtime.sqlite" : "source.tar");
  try {
    const proof = await decryptFile(sourcePath, rawPath, options);
    if (header.kind === "source" || header.kind === "artifacts") extractArchive(rawPath, destinationPath);
    else if (header.kind === "database") {
      fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
      fs.copyFileSync(rawPath, destinationPath);
    } else {
      throw new Error(`Unsupported backup kind: ${header.kind}`);
    }
    return { ...proof, destinationPath };
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

function pruneBackups(destinationRoot = CONFIG.backupDestination, options = {}) {
  if (!fs.existsSync(destinationRoot)) return { kept: [], removed: [] };
  const dailyLimit = options.dailyLimit ?? 7;
  const weeklyLimit = options.weeklyLimit ?? 4;
  const files = fs.readdirSync(destinationRoot)
    .filter((name) => name.endsWith(".jbackup"))
    .map((name) => {
      const filePath = path.join(destinationRoot, name);
      return { filePath, name, mtime: fs.statSync(filePath).mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);
  const dailyKeys = new Map();
  const weeklyKeys = new Map();
  const kept = [];
  const removed = [];
  for (const file of files) {
    const kind = file.name.match(/^jarvis-([a-z]+)-/)?.[1] || "other";
    const day = file.mtime.toISOString().slice(0, 10);
    const week = weekKey(file.mtime);
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
  return { kept, removed };
}

module.exports = {
  createBackup,
  createArtifactArchive,
  createDatabaseSnapshot,
  createSourceArchive,
  decryptFile,
  encryptFile,
  extractArchive,
  pruneBackups,
  readEncryptedHeader,
  requiredPassphrase,
  restoreBackup,
  sha256File,
};
