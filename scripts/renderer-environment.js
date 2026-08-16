#!/usr/bin/env node

const {
  assertRendererEnvironment,
  bootstrapRendererEnvironment,
} = require("../src/runtime/renderer-environment");

function usage() {
  return [
    "Usage:",
    "  node scripts/renderer-environment.js bootstrap --python <absolute-cpython-3.13> [--recreate]",
    "  node scripts/renderer-environment.js check",
  ].join("\n");
}

function parseArguments(args) {
  const [command, ...rest] = args;
  if (command === "check" && rest.length === 0) return { command };
  if (command !== "bootstrap") throw new Error(usage());
  let basePython = null;
  let recreate = false;
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value === "--python" && !basePython && rest[index + 1]) {
      basePython = rest[index + 1];
      index += 1;
    } else if (value === "--recreate" && !recreate) {
      recreate = true;
    } else {
      throw new Error(usage());
    }
  }
  if (!basePython) throw new Error(usage());
  return { command, basePython, recreate };
}

function report(validation) {
  process.stdout.write(`${JSON.stringify({
    ready: validation.ready,
    python: validation.python,
    pythonVersion: validation.pythonVersion,
    source: validation.source,
    environmentRoot: validation.environmentRoot,
    requirementsSha256: validation.requirementsSha256,
    lockPath: validation.lockPath,
    lockSha256: validation.lockSha256,
    packages: validation.packages,
    pinned: validation.pinned,
    inventory: validation.inventory,
    pipCheck: validation.pipCheck,
    ...(validation.basePython ? { basePython: validation.basePython, reused: validation.reused } : {}),
  }, null, 2)}\n`);
}

function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  report(options.command === "check"
    ? assertRendererEnvironment()
    : bootstrapRendererEnvironment(options));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { main, parseArguments };
