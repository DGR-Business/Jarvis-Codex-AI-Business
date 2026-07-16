const path = require("node:path");
const { restoreBackup } = require("../src/runtime/backup");

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const source = argValue("--source");
  const destination = argValue("--destination");
  if (!source || !destination) {
    throw new Error("Usage: npm run restore -- --source <backup.jbackup> --destination <path>");
  }
  const result = await restoreBackup(path.resolve(source), path.resolve(destination));
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
