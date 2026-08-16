const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { parseArguments } = require("../scripts/renderer-environment");
const {
  REQUIRED_DISTRIBUTIONS,
  bootstrapRendererEnvironment,
  isHostedGitHubActions,
  parseRendererRequirementsText,
  rendererEnvironmentRoot,
  rendererPythonPath,
  rendererReadiness,
  resolveRendererPython,
  sanitizedPythonEnvironment,
  validateRendererEnvironment,
} = require("../src/runtime/renderer-environment");

const workspaceRoot = path.resolve(__dirname, "..");

function createBootstrapHarness(name, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `pantheon-renderer-${name}-`));
  const basePython = path.join(
    root,
    "base-cpython",
    process.platform === "win32" ? "python.exe" : "python",
  );
  const basePrefix = path.dirname(basePython);
  const target = rendererEnvironmentRoot(root);
  const python = rendererPythonPath(root);
  fs.mkdirSync(basePrefix, { recursive: true });
  fs.writeFileSync(basePython, "synthetic base CPython boundary\n");
  fs.copyFileSync(
    path.join(workspaceRoot, "requirements-runtime.txt"),
    path.join(root, "requirements-runtime.txt"),
  );
  const pins = parseRendererRequirementsText(
    fs.readFileSync(path.join(root, "requirements-runtime.txt"), "utf8"),
  );
  const calls = [];
  const successful = (stdout = "") => ({ status: 0, stdout, stderr: "" });
  const spawn = (command, args, spawnOptions) => {
    calls.push({ command, args: [...args], options: spawnOptions });
    if (path.resolve(command) === path.resolve(basePython) && args[1] === "-c") {
      return successful(JSON.stringify({
        implementation: "cpython",
        version: [3, 13, 3],
        executable: basePython,
        prefix: basePrefix,
        base_prefix: basePrefix,
      }));
    }
    if (
      path.resolve(command) === path.resolve(basePython)
      && args[0] === "-I"
      && args[1] === "-m"
      && args[2] === "venv"
      && path.resolve(args[3]) === path.resolve(target)
    ) {
      fs.mkdirSync(path.dirname(python), { recursive: true });
      fs.writeFileSync(python, "synthetic renderer interpreter boundary\n");
      fs.writeFileSync(
        path.join(target, "pyvenv.cfg"),
        `home = ${basePrefix}\ninclude-system-site-packages = false\n`,
      );
      return successful();
    }
    if (path.resolve(command) === path.resolve(python) && args.includes("install")) {
      if (options.failInstall) {
        return { status: 1, stdout: "", stderr: "synthetic install rejection" };
      }
      fs.mkdirSync(spawnOptions.env.PIP_CACHE_DIR, { recursive: true });
      return successful("installed synthetic renderer contract");
    }
    if (path.resolve(command) === path.resolve(python) && args[1] === "-c") {
      const inventory = Object.entries(pins).map(([packageName, version]) => ({
        name: packageName,
        version,
      }));
      if (options.duplicateDistribution) {
        inventory.push({
          name: options.duplicateDistribution,
          version: pins[options.duplicateDistribution],
        });
      }
      return successful(JSON.stringify({
        implementation: "cpython",
        version: [3, 13, 3],
        executable: python,
        prefix: target,
        base_prefix: basePrefix,
        user_site_enabled: false,
        packages: pins,
        inventory,
      }));
    }
    if (
      path.resolve(command) === path.resolve(python)
      && args[0] === "-I"
      && args[1] === "-m"
      && args[2] === "pip"
      && args[3] === "check"
    ) {
      return successful("No broken requirements found.");
    }
    return { status: 1, stdout: "", stderr: "unexpected synthetic renderer command" };
  };
  return { basePrefix, basePython, calls, python, root, spawn, target };
}

test("renderer requirements contain exactly four direct exact roots", () => {
  const tracked = fs.readFileSync(path.join(workspaceRoot, "requirements-runtime.txt"), "utf8");
  const pins = parseRendererRequirementsText(tracked);
  assert.deepEqual(Object.keys(pins), REQUIRED_DISTRIBUTIONS.map(([name]) => name));
  for (const invalid of [
    tracked.replace(/^openpyxl==(.+)$/m, "openpyxl>=$1"),
    tracked.replace(/^openpyxl==.+$/m, "openpyxl==3.*"),
    tracked.replace(/^reportlab==.+\r?\n/m, ""),
    `${tracked}requests==2.0.0\n`,
    tracked.replace(/^(openpyxl)==(.+)$/m, "$1==$2\nOPENPYXL==$2"),
  ]) {
    assert.throws(() => parseRendererRequirementsText(invalid));
  }
});

test("local renderer discovery is canonical and every alias ambiguity fails closed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-renderer-local-"));
  try {
    const canonical = rendererPythonPath(root);
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
    fs.writeFileSync(canonical, "synthetic renderer interpreter boundary\n");
    assert.equal(rendererEnvironmentRoot(root), path.join(root, ".venv-renderer"));
    assert.equal(resolveRendererPython({ rootDir: root, environment: {} }).python, canonical);
    assert.throws(
      () => resolveRendererPython({
        rootDir: root,
        environment: { PANTHEON_PYTHON: canonical },
      }),
      /must both be absent/i,
    );
    assert.throws(
      () => resolveRendererPython({
        rootDir: root,
        environment: { PANTHEON_PYTHON: "python", JARVIS_PYTHON: "python" },
      }),
      /absolute paths/i,
    );
    assert.throws(
      () => resolveRendererPython({
        rootDir: root,
        environment: { PANTHEON_PYTHON: canonical, JARVIS_PYTHON: process.execPath },
      }),
      /different interpreters/i,
    );
    assert.throws(
      () => resolveRendererPython({
        rootDir: root,
        environment: { PANTHEON_PYTHON: process.execPath, JARVIS_PYTHON: process.execPath },
      }),
      /foreign renderer interpreter/i,
    );
    const aliases = resolveRendererPython({
      rootDir: root,
      environment: {
        PANTHEON_PYTHON: process.platform === "win32" ? canonical.toUpperCase() : canonical,
        JARVIS_PYTHON: canonical,
      },
    });
    assert.equal(aliases.python, canonical);
    assert.equal(aliases.source, "repository-aliases");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing canonical environment is reported without trying ambient Python", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-renderer-missing-"));
  try {
    fs.copyFileSync(
      path.join(workspaceRoot, "requirements-runtime.txt"),
      path.join(root, "requirements-runtime.txt"),
    );
    assert.throws(
      () => resolveRendererPython({ rootDir: root, environment: {} }),
      /repository renderer environment is missing/i,
    );
    const readiness = rendererReadiness({ rootDir: root, environment: {} });
    assert.equal(readiness.ready, false);
    assert.match(readiness.reason, /renderer environment is missing/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("only exact GitHub-hosted workspace provenance permits an external coherent interpreter", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-setup-python-"));
  try {
    const pythonLocation = path.join(root, "toolcache", "Python", "3.13", "x64");
    const setupPython = process.platform === "win32"
      ? path.join(pythonLocation, "python.exe")
      : path.join(pythonLocation, "bin", "python");
    fs.mkdirSync(path.dirname(setupPython), { recursive: true });
    fs.writeFileSync(setupPython, "synthetic setup-python interpreter boundary\n");
    const hosted = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_WORKSPACE: workspaceRoot,
      JARVIS_PYTHON: setupPython,
      PANTHEON_PYTHON: setupPython,
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_OS: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
      pythonLocation,
    };
    assert.equal(isHostedGitHubActions(hosted, workspaceRoot), true);
    const resolved = resolveRendererPython({ rootDir: workspaceRoot, environment: hosted });
    assert.equal(resolved.python, setupPython);
    assert.equal(resolved.hosted, true);
    assert.equal(resolved.source, "github-hosted-setup-python");
    for (const environment of [
      { ...hosted, RUNNER_ENVIRONMENT: "self-hosted" },
      { ...hosted, GITHUB_WORKSPACE: path.dirname(workspaceRoot) },
      { ...hosted, PANTHEON_PYTHON: process.execPath, JARVIS_PYTHON: process.execPath },
      { ...hosted, pythonLocation: undefined },
    ]) {
      assert.throws(
        () => resolveRendererPython({ rootDir: workspaceRoot, environment }),
        /foreign renderer interpreter/i,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("exact validation proves CPython, pins, transitives, and pip health without caching drift", () => {
  const validation = validateRendererEnvironment({ rootDir: workspaceRoot, environment: process.env });
  assert.equal(validation.ready, true);
  assert.match(validation.pythonVersion, /^3\.13\./);
  assert.deepEqual(validation.packages, validation.pinned);
  assert.equal(validation.pipCheck, "pass");
  assert.ok(validation.inventory.some((item) => item.name.toLowerCase() === "pip"));

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-renderer-contract-"));
  try {
    const mismatchedPath = path.join(root, "requirements-runtime.txt");
    fs.writeFileSync(
      mismatchedPath,
      fs.readFileSync(path.join(workspaceRoot, "requirements-runtime.txt"), "utf8")
        .replace(/^pypdfium2==.+$/m, "pypdfium2==0.0.0"),
    );
    const mismatch = rendererReadiness({
      rootDir: workspaceRoot,
      requirementsPath: mismatchedPath,
      environment: process.env,
    });
    assert.equal(mismatch.ready, false);
    assert.match(mismatch.reason, /do not match requirements-runtime/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Python subprocess state ignores inherited pip indexes, credentials, and user paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-renderer-env-"));
  const previous = {
    PIP_INDEX_URL: process.env.PIP_INDEX_URL,
    PIP_EXTRA_INDEX_URL: process.env.PIP_EXTRA_INDEX_URL,
    PYTHONPATH: process.env.PYTHONPATH,
  };
  try {
    process.env.PIP_INDEX_URL = "https://credential.invalid/simple";
    process.env.PIP_EXTRA_INDEX_URL = "https://other.invalid/simple";
    process.env.PYTHONPATH = path.join(root, "hostile-python-path");
    const environment = sanitizedPythonEnvironment({
      python: rendererPythonPath(workspaceRoot),
      tempRoot: root,
      network: false,
    });
    assert.equal(environment.PIP_INDEX_URL, undefined);
    assert.equal(environment.PIP_EXTRA_INDEX_URL, undefined);
    assert.equal(environment.PYTHONPATH, undefined);
    assert.equal(environment.PIP_NO_INDEX, "1");
    assert.equal(environment.PYTHONNOUSERSITE, "1");
    assert.ok(environment.PIP_CACHE_DIR.startsWith(root));
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bootstrap is isolated, environment-local, and idempotently reuses one exact base", () => {
  const harness = createBootstrapHarness("bootstrap");
  try {
    const first = bootstrapRendererEnvironment({
      rootDir: harness.root,
      basePython: harness.basePython,
      spawn: harness.spawn,
    });
    assert.equal(first.ready, true);
    assert.equal(first.reused, false);
    assert.equal(first.basePython, harness.basePython);
    assert.equal(first.basePrefix, harness.basePrefix);
    assert.equal(first.python, harness.python);

    const installCalls = harness.calls.filter(({ args }) => args.includes("install"));
    const venvCalls = harness.calls.filter(({ args }) => args[2] === "venv");
    assert.equal(installCalls.length, 1);
    assert.equal(venvCalls.length, 1);
    const install = installCalls[0];
    assert.equal(install.command, harness.python);
    assert.ok(install.args.includes("--isolated"));
    assert.deepEqual(
      install.args.slice(install.args.indexOf("--index-url"), install.args.indexOf("--index-url") + 2),
      ["--index-url", "https://pypi.org/simple"],
    );
    assert.deepEqual(
      install.args.slice(install.args.indexOf("--requirement"), install.args.indexOf("--requirement") + 2),
      ["--requirement", path.join(harness.root, "requirements-runtime.txt")],
    );
    assert.equal(install.options.env.PIP_CACHE_DIR, path.join(harness.target, ".pip-cache"));
    assert.equal(install.options.env.PIP_CONFIG_FILE, process.platform === "win32" ? "nul" : "/dev/null");
    assert.equal(install.options.env.PIP_INDEX_URL, undefined);
    assert.equal(install.options.env.PIP_EXTRA_INDEX_URL, undefined);
    assert.ok(fs.statSync(path.join(harness.target, ".pip-cache")).isDirectory());

    const second = bootstrapRendererEnvironment({
      rootDir: harness.root,
      basePython: harness.basePython,
      spawn: harness.spawn,
    });
    assert.equal(second.ready, true);
    assert.equal(second.reused, true);
    assert.equal(second.basePrefix, harness.basePrefix);
    assert.equal(harness.calls.filter(({ args }) => args.includes("install")).length, 1);
    assert.equal(harness.calls.filter(({ args }) => args[2] === "venv").length, 1);
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
  }
});

test("bootstrap rejects unauthorized contracts and targets, and cleans failed installs", () => {
  const invalid = createBootstrapHarness("invalid-contract");
  try {
    fs.appendFileSync(path.join(invalid.root, "requirements-runtime.txt"), "requests==2.0.0\n");
    fs.mkdirSync(invalid.target, { recursive: true });
    const sentinel = path.join(invalid.target, "must-remain.txt");
    fs.writeFileSync(sentinel, "preserve\n");
    assert.throws(
      () => bootstrapRendererEnvironment({
        rootDir: invalid.root,
        basePython: invalid.basePython,
        spawn: invalid.spawn,
      }),
      /only the four renderer roots/i,
    );
    assert.equal(invalid.calls.length, 0);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "preserve\n");
  } finally {
    fs.rmSync(invalid.root, { recursive: true, force: true });
  }

  const guarded = createBootstrapHarness("guarded-target");
  try {
    fs.writeFileSync(guarded.target, "not a directory\n");
    assert.throws(
      () => bootstrapRendererEnvironment({
        rootDir: guarded.root,
        basePython: guarded.basePython,
        spawn: guarded.spawn,
      }),
      /refused to replace a non-directory/i,
    );
    assert.equal(fs.readFileSync(guarded.target, "utf8"), "not a directory\n");
    assert.equal(guarded.calls.filter(({ args }) => args.includes("install")).length, 0);
  } finally {
    fs.rmSync(guarded.root, { recursive: true, force: true });
  }

  const failed = createBootstrapHarness("failed-install", { failInstall: true });
  try {
    assert.throws(
      () => bootstrapRendererEnvironment({
        rootDir: failed.root,
        basePython: failed.basePython,
        spawn: failed.spawn,
      }),
      /synthetic install rejection/i,
    );
    assert.equal(fs.existsSync(failed.target), false);
    assert.equal(failed.calls.filter(({ args }) => args[2] === "venv").length, 1);
    assert.equal(failed.calls.filter(({ args }) => args.includes("install")).length, 1);
  } finally {
    fs.rmSync(failed.root, { recursive: true, force: true });
  }

  const duplicate = createBootstrapHarness("duplicate-metadata", {
    duplicateDistribution: "pypdfium2",
  });
  try {
    assert.throws(
      () => bootstrapRendererEnvironment({
        rootDir: duplicate.root,
        basePython: duplicate.basePython,
        spawn: duplicate.spawn,
      }),
      /versions or metadata do not match requirements-runtime/i,
    );
    assert.equal(fs.existsSync(duplicate.target), false);
  } finally {
    fs.rmSync(duplicate.root, { recursive: true, force: true });
  }
});

test("renderer environment CLI accepts only the documented check and bootstrap forms", () => {
  assert.deepEqual(parseArguments(["check"]), { command: "check" });
  assert.deepEqual(
    parseArguments(["bootstrap", "--python", process.execPath, "--recreate"]),
    { command: "bootstrap", basePython: process.execPath, recreate: true },
  );
  assert.throws(() => parseArguments(["check", "--recreate"]), /Usage:/);
  assert.throws(() => parseArguments(["bootstrap"]), /Usage:/);
});

test("configuration never manufactures a coherent pair from one Python alias", () => {
  const environment = {
    ...process.env,
    PANTHEON_PYTHON: path.join(workspaceRoot, "foreign-python.exe"),
  };
  delete environment.JARVIS_PYTHON;
  const child = spawnSync(
    process.execPath,
    [
      "-e",
      "require('./src/config');process.stdout.write(String(process.env.JARVIS_PYTHON))",
    ],
    {
      cwd: workspaceRoot,
      env: environment,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    },
  );
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, "undefined");
});
