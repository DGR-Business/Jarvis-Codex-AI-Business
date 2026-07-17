const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

const port = Number(process.argv[2] || 5051);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Jarvis requires a valid local port.");
}

process.env.PORT = String(port);
if (process.env.JARVIS_ENABLE_IMAGE_GENERATION !== "1") {
  process.env.JARVIS_ENABLE_IMAGE_GENERATION = "0";
}
process.env.JARVIS_LIVE_MODE = "0";
const logRoot = path.resolve(__dirname, "..", "tmp");
fs.mkdirSync(logRoot, { recursive: true });
const standardLog = fs.createWriteStream(path.join(logRoot, `jarvis-server-${port}.log`), { flags: "a" });
const errorLog = fs.createWriteStream(path.join(logRoot, `jarvis-server-${port}-error.log`), { flags: "a" });

function writeLog(stream, values) {
  stream.write(`${new Date().toISOString()} ${util.format(...values)}\n`);
}

console.log = (...values) => writeLog(standardLog, values);
console.error = (...values) => writeLog(errorLog, values);
let runtime = null;
let ending = false;

async function shutdown(exitCode = 0) {
  if (ending) return;
  ending = true;
  try {
    await runtime?.server?.shutdown?.();
  } catch (error) {
    writeLog(errorLog, [error?.stack || error]);
    exitCode = 1;
  } finally {
    standardLog.end();
    errorLog.end();
    process.exitCode = exitCode;
  }
}

process.on("uncaughtException", (error) => {
  writeLog(errorLog, [error?.stack || error]);
  shutdown(1);
});
process.on("unhandledRejection", (error) => {
  writeLog(errorLog, [error?.stack || error]);
  shutdown(1);
});
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

require("../src/server").startServer({ port }).then((started) => {
  runtime = started;
}).catch((error) => {
  writeLog(errorLog, [error?.stack || error]);
  process.exit(1);
});
