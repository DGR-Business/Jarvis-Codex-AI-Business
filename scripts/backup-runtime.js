const path = require("node:path");
const CONFIG = require("../src/config");
const { createBackup, pruneBackups, verifyBackup } = require("../src/runtime/backup");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log(
      "Usage: node scripts/backup-runtime.js "
      + "[--kind set|all|source|database|artifacts] "
      + "[--destination <directory>] [--source-root <directory>] "
      + "[--database <file>] [--artifacts <directory>] "
      + "[--approval-packs <directory>] [--private-operator <directory>]",
    );
    console.log("The default 'all' mode creates one encrypted, verified Pantheon recovery set.");
    return;
  }
  const requestedKind = argValue("--kind") || "all";
  if (!["source", "database", "artifacts", "set", "all"].includes(requestedKind)) {
    throw new Error(`Unsupported backup kind: ${requestedKind}`);
  }
  const kinds = requestedKind === "all" ? ["set"] : [requestedKind];
  const destinationRoot = path.resolve(argValue("--destination") || CONFIG.backupDestination);
  const results = [];
  for (const kind of kinds) {
    const backup = await createBackup({
      kind,
      destinationRoot,
      sourceRoot: argValue("--source-root"),
      dbPath: argValue("--database"),
      artifactRoot: argValue("--artifacts"),
      approvalPackRoot: argValue("--approval-packs"),
      privateOperatorRoot: argValue("--private-operator"),
    });
    const verification = await verifyBackup(backup.destinationPath);
    results.push({
      ...backup,
      verification: {
        verified: verification.verified,
        kind: verification.kind,
        setId: verification.recoverySet?.setId,
        fileCount: verification.recoverySet?.fileCount,
        sqlite: verification.recoverySet?.sqlite || verification.sqlite,
      },
    });
  }
  const retention = pruneBackups(destinationRoot);
  console.log(JSON.stringify({
    ok: true,
    mode: requestedKind === "all" ? "coherent-recovery-set" : requestedKind,
    destinationRoot,
    backups: results,
    retention,
  }, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { argValue, main };
