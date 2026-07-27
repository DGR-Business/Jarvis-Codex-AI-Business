const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");
const { environmentEnabled } = require("../src/adapters/pantheon-environment");

const port = Number(process.argv[2] || 5051);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Pantheon requires a valid local port.");
}

process.env.PORT = String(port);
if (!environmentEnabled("enableImageGeneration")) {
  process.env.PANTHEON_ENABLE_IMAGE_GENERATION = "0";
}
process.env.PANTHEON_LIVE_MODE = "0";
const logRoot = path.resolve(__dirname, "..", "tmp");
fs.mkdirSync(logRoot, { recursive: true });
const standardLog = fs.createWriteStream(path.join(logRoot, `pantheon-server-${port}.log`), { flags: "a" });
const errorLog = fs.createWriteStream(path.join(logRoot, `pantheon-server-${port}-error.log`), { flags: "a" });

function writeLog(stream, values) {
  stream.write(`${new Date().toISOString()} ${util.format(...values)}\n`);
}

console.log = (...values) => writeLog(standardLog, values);
console.error = (...values) => writeLog(errorLog, values);
let runtime = null;
let ending = false;

function closeLog(stream) {
  return new Promise((resolve) => {
    if (stream.closed || stream.destroyed) return resolve();
    stream.end(resolve);
  });
}

async function shutdown(exitCode = 0) {
  if (ending) return;
  ending = true;
  const forcedExit = setTimeout(() => process.exit(exitCode || 1), 10_000);
  forcedExit.unref();
  try {
    await runtime?.server?.shutdown?.();
  } catch (error) {
    writeLog(errorLog, [error?.stack || error]);
    exitCode = 1;
  } finally {
    await Promise.all([closeLog(standardLog), closeLog(errorLog)]);
    clearTimeout(forcedExit);
    process.exit(exitCode);
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
  runtime.server.once("close", () => setImmediate(() => shutdown(0)));
}).catch((error) => {
  writeLog(errorLog, [error?.stack || error]);
  process.exit(1);
});
