const fs = require("node:fs");
const path = require("node:path");
const util = require("node:util");

const port = Number(process.argv[2] || 5051);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("Jarvis requires a valid local port.");
}

process.env.PORT = String(port);
delete process.env.OPENAI_API_KEY;
process.env.JARVIS_ENABLE_LIVE_MODELS = "0";
process.env.JARVIS_ENABLE_LIVE_RESEARCH = "0";
process.env.JARVIS_LIVE_MODE = "0";
const logRoot = path.resolve(__dirname, "..", "tmp");
fs.mkdirSync(logRoot, { recursive: true });
const standardLog = fs.createWriteStream(path.join(logRoot, "jarvis-server.log"), { flags: "a" });
const errorLog = fs.createWriteStream(path.join(logRoot, "jarvis-server-error.log"), { flags: "a" });

function writeLog(stream, values) {
  stream.write(`${new Date().toISOString()} ${util.format(...values)}\n`);
}

console.log = (...values) => writeLog(standardLog, values);
console.error = (...values) => writeLog(errorLog, values);
process.on("uncaughtException", (error) => {
  writeLog(errorLog, [error?.stack || error]);
  process.exit(1);
});
process.on("unhandledRejection", (error) => {
  writeLog(errorLog, [error?.stack || error]);
  process.exit(1);
});
require("../src/server").startServer({ port }).catch((error) => {
  writeLog(errorLog, [error?.stack || error]);
  process.exit(1);
});
