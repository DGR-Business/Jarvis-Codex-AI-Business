const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const { parseArguments } = require("../scripts/renderer-environment");
const {
  RENDERER_INVENTORY_DISTRIBUTIONS,
  RENDERER_LOCK_FILENAME,
  REQUIRED_DISTRIBUTIONS,
  bootstrapRendererEnvironment,
  isHostedGitHubActions,
  normalizeDistributionName,
  parseRendererInventoryText,
  parseRendererRequirementsText,
  readRendererRequirements,
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
  fs.copyFileSync(
    path.join(workspaceRoot, RENDERER_LOCK_FILENAME),
    path.join(root, RENDERER_LOCK_FILENAME),
  );
  const pins = parseRendererInventoryText(
    fs.readFileSync(path.join(root, RENDERER_LOCK_FILENAME), "utf8"),
  );
  const calls = [];
  let generation = 0;
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
      generation += 1;
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
      let inventory = Object.entries(pins).map(([packageName, version]) => ({
        name: packageName,
        version,
      }));
      const packages = { ...pins };
      if (options.unexpectedDistribution && !(options.pollutedBeforeRebuild && generation > 0)) {
        inventory.push({ name: options.unexpectedDistribution, version: "1.0.0" });
      }
      if (options.changedDistribution) {
        const normalized = normalizeDistributionName(options.changedDistribution);
        const canonical = Object.keys(pins).find(
          (name) => normalizeDistributionName(name) === normalized,
        );
        inventory = inventory.map((item) => (
          normalizeDistributionName(item.name) === normalized
            ? { ...item, version: "0.0.0" }
            : item
        ));
        if (canonical) packages[canonical] = "0.0.0";
      }
      if (options.missingDistribution) {
        const normalized = normalizeDistributionName(options.missingDistribution);
        const canonical = Object.keys(pins).find(
          (name) => normalizeDistributionName(name) === normalized,
        );
        inventory = inventory.filter((item) => normalizeDistributionName(item.name) !== normalized);
        if (canonical) delete packages[canonical];
      }
      if (options.duplicateDistribution) {
        const normalized = normalizeDistributionName(options.duplicateDistribution);
        const canonical = Object.keys(pins).find(
          (name) => normalizeDistributionName(name) === normalized,
        );
        inventory.push({
          name: options.duplicateAlias || options.duplicateDistribution,
          version: pins[canonical],
        });
      }
      return successful(JSON.stringify({
        implementation: "cpython",
        version: [3, 13, 3],
        executable: python,
        prefix: target,
        base_prefix: basePrefix,
        user_site_enabled: false,
        packages,
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

test("renderer inventory contract contains exactly seven unique normalized exact pins", () => {
  const tracked = fs.readFileSync(path.join(workspaceRoot, RENDERER_LOCK_FILENAME), "utf8");
  const pins = parseRendererInventoryText(tracked);
  assert.deepEqual(
    Object.keys(pins),
    RENDERER_INVENTORY_DISTRIBUTIONS.map(([name]) => name),
  );
  for (const invalid of [
    tracked.replace(/^pip==(.+)$/m, "pip>=$1"),
    tracked.replace(/^charset-normalizer==.+\r?\n/m, ""),
    `${tracked}requests==2.0.0\n`,
    tracked.replace(/^(et_xmlfile)==(.+)$/m, "$1==$2\net-xmlfile==$2"),
  ]) {
    assert.throws(() => parseRendererInventoryText(invalid));
  }
  const contract = readRendererRequirements({ rootDir: workspaceRoot });
  assert.deepEqual(contract.pins, Object.fromEntries(
    REQUIRED_DISTRIBUTIONS.map(([name]) => [name, pins[name]]),
  ));
  assert.match(contract.requirementsSha256, /^[a-f0-9]{64}$/);
  assert.match(contract.lockSha256, /^[a-f0-9]{64}$/);
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
    fs.copyFileSync(
      path.join(workspaceRoot, RENDERER_LOCK_FILENAME),
      path.join(root, RENDERER_LOCK_FILENAME),
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

test("GitHub-hosted provenance keeps setup-python bootstrap-only and resolves the canonical local runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-setup-python-"));
  try {
    const canonical = rendererPythonPath(root);
    fs.mkdirSync(path.dirname(canonical), { recursive: true });
    fs.writeFileSync(canonical, "synthetic repository renderer interpreter boundary\n");
    const pythonLocation = path.join(root, "toolcache", "Python", "3.13", "x64");
    const setupPython = process.platform === "win32"
      ? path.join(pythonLocation, "python.exe")
      : path.join(pythonLocation, "bin", "python");
    fs.mkdirSync(path.dirname(setupPython), { recursive: true });
    fs.writeFileSync(setupPython, "synthetic setup-python interpreter boundary\n");
    const hosted = {
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_WORKSPACE: root,
      JARVIS_PYTHON: canonical,
      PANTHEON_PYTHON: canonical,
      RUNNER_ENVIRONMENT: "github-hosted",
      RUNNER_OS: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
      pythonLocation,
    };
    assert.equal(isHostedGitHubActions(hosted, root), true);
    const resolved = resolveRendererPython({ rootDir: root, environment: hosted });
    assert.equal(resolved.python, canonical);
    assert.equal(resolved.hosted, true);
    assert.equal(resolved.source, "repository-aliases");
    const defaultResolved = resolveRendererPython({
      rootDir: root,
      environment: { ...hosted, PANTHEON_PYTHON: undefined, JARVIS_PYTHON: undefined },
    });
    assert.equal(defaultResolved.python, canonical);
    assert.equal(defaultResolved.hosted, true);
    assert.equal(defaultResolved.source, "repository-default");
    assert.throws(
      () => resolveRendererPython({
        rootDir: root,
        environment: { ...hosted, PANTHEON_PYTHON: setupPython, JARVIS_PYTHON: setupPython },
      }),
      /foreign renderer interpreter/i,
    );
    for (const environment of [
      { ...hosted, RUNNER_ENVIRONMENT: "self-hosted" },
      { ...hosted, GITHUB_WORKSPACE: path.dirname(root) },
      { ...hosted, pythonLocation: undefined },
    ]) {
      assert.equal(isHostedGitHubActions(environment, root), false);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("exact validation proves CPython, the full inventory, and pip health without caching drift", () => {
  const validation = validateRendererEnvironment({ rootDir: workspaceRoot, environment: process.env });
  assert.equal(validation.ready, true);
  assert.match(validation.pythonVersion, /^3\.13\./);
  assert.deepEqual(validation.packages, validation.pinned);
  assert.equal(validation.pipCheck, "pass");
  assert.deepEqual(
    validation.inventory.map((item) => ({
      name: normalizeDistributionName(item.name),
      version: item.version,
    })).sort((left, right) => left.name.localeCompare(right.name)),
    Object.entries(validation.pinned)
      .map(([name, version]) => ({ name: normalizeDistributionName(name), version }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
  assert.equal(validation.pinned.pip, "26.2.1");

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
    assert.match(mismatch.reason, /requirements-runtime.*requirements-renderer-lock.*disagree/i);
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
    assert.ok(install.args.includes("--upgrade"));
    assert.ok(install.args.includes("--no-deps"));
    assert.ok(install.args.includes("--only-binary=:all:"));
    assert.deepEqual(
      install.args.slice(install.args.indexOf("--index-url"), install.args.indexOf("--index-url") + 2),
      ["--index-url", "https://pypi.org/simple"],
    );
    assert.deepEqual(
      install.args.slice(install.args.indexOf("--requirement"), install.args.indexOf("--requirement") + 2),
      ["--requirement", path.join(harness.root, RENDERER_LOCK_FILENAME)],
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
    assert.deepEqual(second.packages, second.pinned);
    assert.equal(second.inventory.length, 7);
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

});

test("full inventory validation rejects extras, transitive drift, missing metadata, normalized duplicates, and pip drift", () => {
  const cases = [
    {
      name: "unexpected",
      options: { unexpectedDistribution: "requests" },
      field: "unexpected",
      expected: "requests",
    },
    {
      name: "changed-transitive",
      options: { changedDistribution: "charset-normalizer" },
      field: "mismatched",
      expected: "charset-normalizer",
    },
    {
      name: "missing-transitive",
      options: { missingDistribution: "et_xmlfile" },
      field: "missing",
      expected: "et_xmlfile",
    },
    {
      name: "duplicate-normalized",
      options: { duplicateDistribution: "et_xmlfile", duplicateAlias: "et-xmlfile" },
      field: "duplicates",
      expected: "et-xmlfile",
    },
    {
      name: "pip-mismatch",
      options: { changedDistribution: "pip" },
      field: "mismatched",
      expected: "pip",
    },
  ];
  for (const fixture of cases) {
    const harness = createBootstrapHarness(fixture.name, fixture.options);
    try {
      assert.throws(
        () => bootstrapRendererEnvironment({
          rootDir: harness.root,
          basePython: harness.basePython,
          spawn: harness.spawn,
        }),
        (error) => {
          assert.match(error.message, /inventory does not match requirements-renderer-lock/i);
          assert.ok(error[fixture.field].includes(fixture.expected));
          return true;
        },
      );
      assert.equal(fs.existsSync(harness.target), false);
    } finally {
      fs.rmSync(harness.root, { recursive: true, force: true });
    }
  }
});

test("a polluted existing environment is rebuilt and only the repaired inventory is reused", () => {
  const harness = createBootstrapHarness("polluted-rebuild", {
    unexpectedDistribution: "requests",
    pollutedBeforeRebuild: true,
  });
  try {
    fs.mkdirSync(path.dirname(harness.python), { recursive: true });
    fs.writeFileSync(harness.python, "synthetic polluted renderer interpreter boundary\n");
    fs.writeFileSync(
      path.join(harness.target, "pyvenv.cfg"),
      `home = ${harness.basePrefix}\ninclude-system-site-packages = false\n`,
    );
    const repaired = bootstrapRendererEnvironment({
      rootDir: harness.root,
      basePython: harness.basePython,
      spawn: harness.spawn,
    });
    assert.equal(repaired.ready, true);
    assert.equal(repaired.reused, false);
    assert.equal(harness.calls.filter(({ args }) => args[2] === "venv").length, 1);
    assert.equal(harness.calls.filter(({ args }) => args.includes("install")).length, 1);

    const reused = bootstrapRendererEnvironment({
      rootDir: harness.root,
      basePython: harness.basePython,
      spawn: harness.spawn,
    });
    assert.equal(reused.ready, true);
    assert.equal(reused.reused, true);
    assert.equal(harness.calls.filter(({ args }) => args[2] === "venv").length, 1);
    assert.equal(harness.calls.filter(({ args }) => args.includes("install")).length, 1);
  } finally {
    fs.rmSync(harness.root, { recursive: true, force: true });
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

test("hosted ordinary CI bootstraps and checks the checkout-local exact inventory", () => {
  const workflow = fs.readFileSync(path.join(workspaceRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(
    workflow,
    /renderer:bootstrap -- --python "\$env:pythonLocation\\python\.exe" --recreate/,
  );
  assert.match(workflow, /run: npm\.cmd run renderer:check/);
  assert.match(workflow, /requirements-renderer-lock\.txt/);
  assert.doesNotMatch(workflow, /pip install[^\r\n]*requirements-runtime\.txt/);
  assert.doesNotMatch(workflow, /PANTHEON_PYTHON:\s*\$\{\{ env\.pythonLocation \}\}/);
  assert.doesNotMatch(workflow, /JARVIS_PYTHON:\s*\$\{\{ env\.pythonLocation \}\}/);
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
