"use strict";

const path = require("node:path");
const {
  buildSchema27RecoveryCandidate,
} = require("../src/runtime/schema27-offline-recovery");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "Usage: node scripts/build-schema27-recovery-candidate.js "
      + "--source <standalone-snapshot.sqlite> "
      + "--source-backup <exact-encrypted-database.jbackup> "
      + "--source-backup-sha256 <sha256> --candidate <new-candidate.sqlite> "
      + "--recovery-id <id> [--manifest <new-manifest.json>]",
    );
    console.log(
      "Builds and verifies an offline candidate only. It cannot replace Pantheon's active database.",
    );
    return;
  }
  for (const forbidden of ["--replace", "--apply", "--swap", "--force"]) {
    if (process.argv.includes(forbidden)) {
      throw new Error(`${forbidden} is not supported; this command cannot replace a live database.`);
    }
  }
  const source = argValue("--source");
  const sourceBackup = argValue("--source-backup");
  const sourceBackupSha256 = argValue("--source-backup-sha256");
  const candidate = argValue("--candidate");
  const recoveryId = argValue("--recovery-id");
  const manifest = argValue("--manifest");
  if (!source || !sourceBackup || !sourceBackupSha256 || !candidate || !recoveryId) {
    throw new Error(
      "--source, --source-backup, --source-backup-sha256, --candidate and --recovery-id "
      + "are required. Use --help for the exact offline flow.",
    );
  }
  const result = await buildSchema27RecoveryCandidate({
    sourcePath: path.resolve(source),
    sourceBackupPath: path.resolve(sourceBackup),
    expectedSourceBackupSha256: sourceBackupSha256,
    candidatePath: path.resolve(candidate),
    recoveryId,
    ...(manifest ? { manifestPath: path.resolve(manifest) } : {}),
  });
  console.log(JSON.stringify({
    ok: true,
    mode: "offline-candidate-only",
    recoveryId: result.recoveryId,
    sourcePath: result.sourcePath,
    sourceSha256: result.sourceSha256,
    candidatePath: result.candidatePath,
    candidateSha256: result.candidateSha256,
    manifestPath: result.manifestPath,
    manifestSha256: result.manifestSha256,
    schemaVersion: result.schemaVersion,
    liveDatabaseChanged: false,
    nextAction: "Obtain separate operator authorization before designing or performing any live swap.",
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { argValue, main };
