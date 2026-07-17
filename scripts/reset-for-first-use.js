const path = require("node:path");
const CONFIG = require("../src/config");
const {
  STATIC_COUNTS,
  buildFirstUseDatabase,
  replaceWithFirstUseDatabase,
} = require("../src/runtime/first-use-reset");

function argumentsMap(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

async function assertDashboardStopped(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: controller.signal });
    if (response.ok) {
      const health = await response.json();
      if (health?.ok) throw new Error("Jarvis is still running. Use STOP JARVIS.cmd before applying the first-use reset.");
    }
  } catch (error) {
    if (error.name !== "AbortError" && /still running/i.test(error.message)) throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const args = argumentsMap(process.argv.slice(2));
  if (args.apply !== true || args.confirm !== "CLEAN-FIRST-USE") {
    throw new Error("Reset not applied. Use --apply --confirm CLEAN-FIRST-USE after the encrypted backup has been verified.");
  }
  if (!args["backup-reference"] || !args["reset-id"]) {
    throw new Error("--backup-reference and --reset-id are required.");
  }
  const sourcePath = path.resolve(args.source || CONFIG.dbPath);
  const port = Number(args.port || CONFIG.port);
  await assertDashboardStopped(port);
  const built = buildFirstUseDatabase(sourcePath, {
    resetId: args["reset-id"],
    backupReference: args["backup-reference"],
  });
  if (built.alreadyApplied) {
    console.log(`First-use reset ${built.resetId} was already applied. No changes were made.`);
    return;
  }
  const applied = replaceWithFirstUseDatabase(sourcePath, built.candidatePath, {
    resetId: built.resetId,
    backupReference: args["backup-reference"],
  });
  console.log(`First-use runtime is ready at ${applied.databasePath}.`);
  console.log(`Reset manifest: ${built.manifestSha256}`);
  console.log(`Survivors: ${STATIC_COUNTS.accounting_entries} accounting entries, ${STATIC_COUNTS.costs} provider usage allocations, ${STATIC_COUNTS.ventures} active venture.`);
  console.log(`Static team: ${STATIC_COUNTS.agent_definitions} workers, ${STATIC_COUNTS.agent_tools} tools, ${STATIC_COUNTS.scheduler_jobs} maintenance jobs.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
