const path = require("node:path");
const { restoreBackup, verifyBackup } = require("../src/runtime/backup");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function recoverySetSummary(recoverySet) {
  if (!recoverySet) return undefined;
  return {
    format: recoverySet.format,
    version: recoverySet.version,
    setId: recoverySet.setId,
    createdAt: recoverySet.createdAt,
    fileCount: recoverySet.fileCount,
    bytes: recoverySet.bytes,
    components: recoverySet.components,
    sqlite: recoverySet.sqlite,
  };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "Usage: node scripts/restore-runtime.js --source <backup.jbackup> "
      + "[--destination <path>] [--verify-only] [--replace]",
    );
    console.log("Recovery sets restore into a complete, validated Pantheon workspace layout.");
    return;
  }
  const source = argValue("--source");
  const destination = argValue("--destination");
  const verifyOnly = process.argv.includes("--verify-only");
  if (!source || (!destination && !verifyOnly)) {
    throw new Error(
      "Usage: npm run restore -- --source <backup.jbackup> "
      + "(--destination <path> | --verify-only)",
    );
  }
  if (verifyOnly) {
    const verification = await verifyBackup(path.resolve(source));
    console.log(JSON.stringify({
      ok: true,
      mode: "verify-only",
      kind: verification.kind,
      createdAt: verification.createdAt,
      payloadSha256: verification.payloadSha256,
      verified: verification.verified,
      recoverySet: recoverySetSummary(verification.recoverySet),
      sqlite: verification.sqlite,
    }, null, 2));
    return;
  }
  const result = await restoreBackup(path.resolve(source), path.resolve(destination), {
    replace: process.argv.includes("--replace"),
  });
  console.log(JSON.stringify({
    ok: true,
    kind: result.kind,
    destinationPath: result.destinationPath,
    createdAt: result.createdAt,
    payloadSha256: result.payloadSha256,
    recoverySet: recoverySetSummary(result.recoverySet),
    sqlite: result.sqlite,
    verificationRecord: result.verificationRecord,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { argValue, main, recoverySetSummary };
