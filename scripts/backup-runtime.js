const path = require("node:path");
const CONFIG = require("../src/config");
const { createBackup, pruneBackups } = require("../src/runtime/backup");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.log("Usage: node scripts/backup-runtime.js [--kind source|database|artifacts|all] [--destination <directory>]");
    return;
  }
  const requestedKind = argValue("--kind") || "all";
  if (!["source", "database", "artifacts", "all"].includes(requestedKind)) {
    throw new Error(`Unsupported backup kind: ${requestedKind}`);
  }
  const kinds = requestedKind === "all" ? ["source", "database", "artifacts"] : [requestedKind];
  const destinationRoot = path.resolve(argValue("--destination") || CONFIG.backupDestination);
  const results = [];
  for (const kind of kinds) {
    results.push(await createBackup({ kind, destinationRoot }));
  }
  const retention = pruneBackups(destinationRoot);
  console.log(JSON.stringify({ ok: true, destinationRoot, backups: results, retention }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
