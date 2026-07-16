const CONFIG = require("../src/config");
const { openDatabase, seedDatabase } = require("../src/db");
const { runOnce } = require("../src/runtime/orchestrator");

async function main() {
  const db = openDatabase(CONFIG.dbPath);
  seedDatabase(db);
  const result = await runOnce(db);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
