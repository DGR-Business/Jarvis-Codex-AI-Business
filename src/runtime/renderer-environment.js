const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPOSITORY_ROOT = path.resolve(__dirname, "..", "..");
const RENDERER_ENVIRONMENT_NAME = ".venv-renderer";
const REQUIRED_DISTRIBUTIONS = Object.freeze([
  ["openpyxl", "openpyxl"],
  ["Pillow", "PIL"],
  ["pypdfium2", "pypdfium2"],
  ["reportlab", "reportlab"],
]);
const RENDERER_INVENTORY_DISTRIBUTIONS = Object.freeze([
  ...REQUIRED_DISTRIBUTIONS,
  ["charset-normalizer", "charset_normalizer"],
  ["et_xmlfile", "et_xmlfile"],
  ["pip", "pip"],
]);
const RENDERER_LOCK_FILENAME = "requirements-renderer-lock.txt";
const VALIDATION_TIMEOUT_MS = 30_000;

function environmentValue(environment, requestedName) {
  const matches = Object.entries(environment || {}).filter(
    ([name]) => name.toUpperCase() === requestedName.toUpperCase(),
  );
  const supplied = matches
    .map(([, value]) => String(value || ""))
    .filter(Boolean);
  if (new Set(supplied).size > 1) {
    throw new Error(`Pantheon rejected ambiguous ${requestedName} values.`);
  }
  return supplied[0] || undefined;
}

function platformPath(platform = process.platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function comparableEntryPath(value, platform = process.platform) {
  const resolved = platformPath(platform).resolve(value);
  return platform === "win32" ? resolved.toLowerCase() : resolved;
}

function entryPathsEqual(left, right, platform = process.platform) {
  return comparableEntryPath(left, platform) === comparableEntryPath(right, platform);
}

function rendererEnvironmentRoot(rootDir = REPOSITORY_ROOT) {
  return path.join(path.resolve(rootDir), RENDERER_ENVIRONMENT_NAME);
}

function rendererPythonPath(rootDir = REPOSITORY_ROOT, platform = process.platform) {
  const environmentRoot = rendererEnvironmentRoot(rootDir);
  return platform === "win32"
    ? path.join(environmentRoot, "Scripts", "python.exe")
    : path.join(environmentRoot, "bin", "python");
}

function normalizeDistributionName(value) {
  return String(value).toLowerCase().replace(/[-_.]+/g, "-");
}

function parseRendererRequirementsText(text) {
  const expected = new Map(REQUIRED_DISTRIBUTIONS.map(([name]) => [
    normalizeDistributionName(name),
    name,
  ]));
  const supplied = new Map();
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9][A-Za-z0-9._+!-]*)$/);
    if (!match) {
      throw new Error("Every renderer requirement must be one direct exact == pin.");
    }
    const normalized = normalizeDistributionName(match[1]);
    if (!expected.has(normalized)) {
      throw new Error("requirements-runtime.txt must contain only the four renderer roots.");
    }
    if (supplied.has(normalized)) {
      throw new Error("requirements-runtime.txt contains a duplicate renderer root.");
    }
    supplied.set(normalized, match[2]);
  }
  if (supplied.size !== expected.size || [...expected.keys()].some((name) => !supplied.has(name))) {
    throw new Error("requirements-runtime.txt must contain exactly the four renderer roots.");
  }
  return Object.fromEntries(REQUIRED_DISTRIBUTIONS.map(([name]) => [
    name,
    supplied.get(normalizeDistributionName(name)),
  ]));
}

function parseRendererInventoryText(text) {
  const expected = new Map(RENDERER_INVENTORY_DISTRIBUTIONS.map(([name]) => [
    normalizeDistributionName(name),
    name,
  ]));
  const supplied = new Map();
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9][A-Za-z0-9._+!-]*)$/);
    if (!match) {
      throw new Error(`${RENDERER_LOCK_FILENAME} entries must be exact == pins.`);
    }
    const normalized = normalizeDistributionName(match[1]);
    if (!expected.has(normalized)) {
      throw new Error(`${RENDERER_LOCK_FILENAME} must contain only the seven governed renderer distributions.`);
    }
    if (supplied.has(normalized)) {
      throw new Error(`${RENDERER_LOCK_FILENAME} contains a duplicate normalized distribution.`);
    }
    supplied.set(normalized, match[2]);
  }
  if (supplied.size !== expected.size || [...expected.keys()].some((name) => !supplied.has(name))) {
    throw new Error(`${RENDERER_LOCK_FILENAME} must contain exactly the seven governed renderer distributions.`);
  }
  return Object.fromEntries(RENDERER_INVENTORY_DISTRIBUTIONS.map(([name]) => [
    name,
    supplied.get(normalizeDistributionName(name)),
  ]));
}

function readRendererRequirements(options = {}) {
  const rootDir = path.resolve(options.rootDir || REPOSITORY_ROOT);
  const requirementsPath = path.resolve(
    options.requirementsPath || path.join(rootDir, "requirements-runtime.txt"),
  );
  const lockPath = path.resolve(
    options.lockPath || path.join(rootDir, RENDERER_LOCK_FILENAME),
  );
  if (!fs.existsSync(requirementsPath) || !fs.statSync(requirementsPath).isFile()) {
    throw new Error("requirements-runtime.txt is missing.");
  }
  if (!fs.existsSync(lockPath) || !fs.statSync(lockPath).isFile()) {
    throw new Error(`${RENDERER_LOCK_FILENAME} is missing.`);
  }
  const requirementsText = fs.readFileSync(requirementsPath, "utf8");
  const lockText = fs.readFileSync(lockPath, "utf8");
  const pins = parseRendererRequirementsText(requirementsText);
  const inventoryPins = parseRendererInventoryText(lockText);
  const incoherentRoots = REQUIRED_DISTRIBUTIONS
    .map(([name]) => name)
    .filter((name) => pins[name] !== inventoryPins[name]);
  if (incoherentRoots.length) {
    const error = new Error(
      `requirements-runtime.txt and ${RENDERER_LOCK_FILENAME} disagree (${incoherentRoots.length} root mismatch(es)).`,
    );
    error.mismatched = incoherentRoots;
    throw error;
  }
  return {
    requirementsPath,
    requirementsSha256: crypto.createHash("sha256").update(requirementsText).digest("hex"),
    pins,
    lockPath,
    lockSha256: crypto.createHash("sha256").update(lockText).digest("hex"),
    inventoryPins,
  };
}

function expectedRunnerOs(platform = process.platform) {
  if (platform === "win32") return "Windows";
  if (platform === "darwin") return "macOS";
  return "Linux";
}

function hostedSetupPythonPath(environment, platform = process.platform) {
  const pythonLocation = environmentValue(environment, "pythonLocation");
  if (!pythonLocation || !platformPath(platform).isAbsolute(pythonLocation)) return null;
  return platform === "win32"
    ? platformPath(platform).join(pythonLocation, "python.exe")
    : platformPath(platform).join(pythonLocation, "bin", "python");
}

function isHostedGitHubActions(environment, rootDir = REPOSITORY_ROOT, platform = process.platform) {
  const workspace = environmentValue(environment, "GITHUB_WORKSPACE");
  const setupPython = hostedSetupPythonPath(environment, platform);
  return environmentValue(environment, "CI") === "true"
    && environmentValue(environment, "GITHUB_ACTIONS") === "true"
    && environmentValue(environment, "RUNNER_ENVIRONMENT") === "github-hosted"
    && environmentValue(environment, "RUNNER_OS") === expectedRunnerOs(platform)
    && Boolean(workspace)
    && Boolean(setupPython)
    && platformPath(platform).isAbsolute(workspace)
    && entryPathsEqual(workspace, path.resolve(rootDir), platform);
}

function assertLocalEnvironmentBoundary(rootDir, python, platform = process.platform) {
  const environmentRoot = rendererEnvironmentRoot(rootDir);
  if (!entryPathsEqual(python, rendererPythonPath(rootDir, platform), platform)) {
    throw new Error("Pantheon rejected a foreign renderer interpreter.");
  }
  if (!fs.existsSync(environmentRoot)) {
    throw new Error("Pantheon's repository renderer environment is missing; run renderer:bootstrap.");
  }
  const rootStats = fs.lstatSync(environmentRoot);
  if (
    !rootStats.isDirectory()
    || rootStats.isSymbolicLink()
    || !entryPathsEqual(fs.realpathSync(environmentRoot), environmentRoot, platform)
  ) {
    throw new Error("Pantheon's renderer environment boundary is not a regular repository directory.");
  }
  if (!fs.existsSync(python)) {
    throw new Error("Pantheon's repository renderer interpreter is missing; run renderer:bootstrap.");
  }
  const entryStats = fs.lstatSync(python);
  if (!fs.statSync(python).isFile() || (platform === "win32" && entryStats.isSymbolicLink())) {
    throw new Error("Pantheon's repository renderer interpreter is not a regular executable entry.");
  }
}

function resolveRendererPython(options = {}) {
  const rootDir = path.resolve(options.rootDir || REPOSITORY_ROOT);
  const environment = options.environment || process.env;
  const platform = options.platform || process.platform;
  const canonical = rendererPythonPath(rootDir, platform);
  const hosted = isHostedGitHubActions(environment, rootDir, platform);
  const preferred = environmentValue(environment, "PANTHEON_PYTHON");
  const legacy = environmentValue(environment, "JARVIS_PYTHON");
  if (Boolean(preferred) !== Boolean(legacy)) {
    throw new Error("PANTHEON_PYTHON and JARVIS_PYTHON must both be absent or identify one exact interpreter.");
  }
  if (preferred && legacy) {
    const pathImplementation = platformPath(platform);
    if (!pathImplementation.isAbsolute(preferred) || !pathImplementation.isAbsolute(legacy)) {
      throw new Error("Pantheon's Python aliases must be absolute paths.");
    }
    if (!entryPathsEqual(preferred, legacy, platform)) {
      throw new Error("PANTHEON_PYTHON and JARVIS_PYTHON identify different interpreters.");
    }
    if (entryPathsEqual(preferred, canonical, platform)) {
      assertLocalEnvironmentBoundary(rootDir, canonical, platform);
      return { python: canonical, source: "repository-aliases", rootDir, hosted };
    }
    throw new Error("Pantheon rejected a foreign renderer interpreter.");
  }
  assertLocalEnvironmentBoundary(rootDir, canonical, platform);
  return { python: canonical, source: "repository-default", rootDir, hosted };
}

function sanitizedPythonEnvironment({ python, tempRoot, network = false } = {}) {
  const environment = {};
  for (const name of [
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "SYSTEMDRIVE",
    "SYSTEMROOT",
    "TZ",
    "WINDIR",
  ]) {
    const value = environmentValue(process.env, name);
    if (value) environment[name] = value;
  }
  const profileRoot = path.join(tempRoot, "profile");
  const cacheRoot = path.join(tempRoot, "cache");
  const temporaryRoot = path.join(tempRoot, "temp");
  for (const directory of [profileRoot, cacheRoot, temporaryRoot]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  const pathEntries = [path.dirname(python)];
  const systemRoot = environment.SYSTEMROOT || environment.SystemRoot;
  if (systemRoot) pathEntries.push(path.join(systemRoot, "System32"));
  if (process.platform !== "win32") pathEntries.push("/usr/local/bin", "/usr/bin", "/bin");
  Object.assign(environment, {
    APPDATA: path.join(profileRoot, "AppData", "Roaming"),
    HOME: profileRoot,
    LOCALAPPDATA: path.join(profileRoot, "AppData", "Local"),
    PATH: [...new Set(pathEntries)].join(path.delimiter),
    PIP_CACHE_DIR: cacheRoot,
    PIP_CONFIG_FILE: process.platform === "win32" ? "nul" : "/dev/null",
    PIP_DISABLE_PIP_VERSION_CHECK: "1",
    PIP_KEYRING_PROVIDER: "disabled",
    PIP_NO_INPUT: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    TEMP: temporaryRoot,
    TMP: temporaryRoot,
    TMPDIR: temporaryRoot,
    USERPROFILE: profileRoot,
    XDG_CACHE_HOME: cacheRoot,
    XDG_CONFIG_HOME: path.join(profileRoot, ".config"),
  });
  if (!network) environment.PIP_NO_INDEX = "1";
  return environment;
}

function runChecked(command, args, options = {}) {
  const result = (options.spawn || spawnSync)(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    windowsHide: true,
    timeout: options.timeout || VALIDATION_TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error?.code === "ETIMEDOUT") {
    throw new Error(`${options.label || "Renderer command"} exceeded its deadline.`);
  }
  if (result.error || result.status !== 0) {
    const detail = String(result.error?.message || result.stderr || result.stdout || "unknown error")
      .trim()
      .slice(0, 2000);
    throw new Error(`${options.label || "Renderer command"} failed${detail ? `: ${detail}` : "."}`);
  }
  return String(result.stdout || "").trim();
}

function validateRendererEnvironment(options = {}) {
  const contract = readRendererRequirements(options);
  const resolved = resolveRendererPython(options);
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-renderer-check-"));
  try {
    const environment = sanitizedPythonEnvironment({
      python: resolved.python,
      tempRoot: probeRoot,
      network: false,
    });
    const distributionNames = RENDERER_INVENTORY_DISTRIBUTIONS.map(([name]) => name);
    const importNames = RENDERER_INVENTORY_DISTRIBUTIONS.map(([, importName]) => importName);
    const probeScript = [
      "import importlib.metadata,json,os,site,sys",
      "distribution_names=json.loads(sys.argv[1])",
      "import_names=json.loads(sys.argv[2])",
      "[__import__(name) for name in import_names]",
      "inventory=sorted([{'name':str(item.metadata.get('Name') or item.name or ''),'version':str(item.version or '')} for item in importlib.metadata.distributions()],key=lambda item:item['name'].lower())",
      "print(json.dumps({'implementation':sys.implementation.name,'version':list(sys.version_info[:3]),'executable':os.path.abspath(sys.executable),'prefix':os.path.abspath(sys.prefix),'base_prefix':os.path.abspath(sys.base_prefix),'user_site_enabled':bool(site.ENABLE_USER_SITE),'packages':{name:importlib.metadata.version(name) for name in distribution_names},'inventory':inventory}))",
    ].join("\n");
    const metadata = JSON.parse(runChecked(
      resolved.python,
      ["-I", "-c", probeScript, JSON.stringify(distributionNames), JSON.stringify(importNames)],
      {
        cwd: resolved.rootDir,
        env: environment,
        spawn: options.spawn,
        label: "Renderer interpreter probe",
      },
    ));
    if (metadata.implementation !== "cpython" || metadata.version?.[0] !== 3 || metadata.version?.[1] !== 13) {
      throw new Error("Pantheon's renderer requires CPython 3.13.");
    }
    if (!entryPathsEqual(metadata.executable, resolved.python, options.platform || process.platform)) {
      throw new Error("The renderer process did not preserve its exact interpreter provenance.");
    }
    const environmentRoot = rendererEnvironmentRoot(resolved.rootDir);
    if (
      !entryPathsEqual(metadata.prefix, environmentRoot, options.platform || process.platform)
      || entryPathsEqual(metadata.prefix, metadata.base_prefix, options.platform || process.platform)
    ) {
      throw new Error("Pantheon's renderer interpreter is outside the canonical virtual environment boundary.");
    }
    const configurationPath = path.join(environmentRoot, "pyvenv.cfg");
    const configuration = fs.existsSync(configurationPath)
      ? fs.readFileSync(configurationPath, "utf8")
      : "";
    if (!/^include-system-site-packages\s*=\s*false\s*$/im.test(configuration)) {
      throw new Error("Pantheon's renderer environment inherits system packages.");
    }
    if (metadata.user_site_enabled) {
      throw new Error("Pantheon's renderer process has user-site packages enabled.");
    }
    const expectedByNormalizedName = new Map(distributionNames.map((name) => [
      normalizeDistributionName(name),
      { name, version: contract.inventoryPins[name] },
    ]));
    const actualByNormalizedName = new Map();
    for (const item of Array.isArray(metadata.inventory) ? metadata.inventory : []) {
      const normalized = normalizeDistributionName(item?.name || "");
      const entries = actualByNormalizedName.get(normalized) || [];
      entries.push({
        name: String(item?.name || ""),
        version: String(item?.version || ""),
      });
      actualByNormalizedName.set(normalized, entries);
    }
    const unexpected = [...actualByNormalizedName.keys()]
      .filter((name) => !expectedByNormalizedName.has(name))
      .map((name) => name || "(unnamed)")
      .sort();
    const missing = [...expectedByNormalizedName.entries()]
      .filter(([name]) => !actualByNormalizedName.has(name))
      .map(([, expected]) => expected.name);
    const duplicates = [...actualByNormalizedName.entries()]
      .filter(([, entries]) => entries.length !== 1)
      .map(([name]) => name || "(unnamed)")
      .sort();
    const mismatched = distributionNames.filter((name) => {
      const entries = actualByNormalizedName.get(normalizeDistributionName(name)) || [];
      return String(metadata.packages?.[name] || "") !== contract.inventoryPins[name]
        || (entries.length === 1 && entries[0].version !== contract.inventoryPins[name]);
    });
    if (unexpected.length || missing.length || duplicates.length || mismatched.length) {
      const error = new Error(
        `Installed renderer inventory does not match ${RENDERER_LOCK_FILENAME} `
        + `(unexpected=${unexpected.length}, missing=${missing.length}, duplicates=${duplicates.length}, mismatched=${mismatched.length}).`,
      );
      error.unexpected = unexpected;
      error.missing = missing;
      error.duplicates = duplicates;
      error.mismatched = mismatched;
      throw error;
    }
    runChecked(resolved.python, ["-I", "-m", "pip", "check"], {
      cwd: resolved.rootDir,
      env: environment,
      spawn: options.spawn,
      label: "Renderer dependency check",
    });
    return {
      ready: true,
      python: resolved.python,
      pythonVersion: metadata.version.join("."),
      source: resolved.source,
      hosted: resolved.hosted,
      basePrefix: metadata.base_prefix,
      environmentRoot,
      requirementsPath: contract.requirementsPath,
      requirementsSha256: contract.requirementsSha256,
      lockPath: contract.lockPath,
      lockSha256: contract.lockSha256,
      packages: metadata.packages,
      pinned: contract.inventoryPins,
      runtimePinned: contract.pins,
      inventory: metadata.inventory,
      pipCheck: "pass",
    };
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
}

function rendererReadiness(options = {}) {
  try {
    return validateRendererEnvironment(options);
  } catch (error) {
    return {
      ready: false,
      python: null,
      reason: error.message,
      unexpected: Array.isArray(error.unexpected) ? [...error.unexpected] : [],
      missing: Array.isArray(error.missing) ? [...error.missing] : [],
      duplicates: Array.isArray(error.duplicates) ? [...error.duplicates] : [],
      mismatched: Array.isArray(error.mismatched) ? [...error.mismatched] : [],
    };
  }
}

function assertRendererEnvironment(options = {}) {
  return validateRendererEnvironment(options);
}

function assertBasePython(basePython, options = {}) {
  if (!basePython || !path.isAbsolute(basePython)) {
    throw new Error("renderer:bootstrap requires one explicit absolute --python path.");
  }
  if (!fs.existsSync(basePython) || !fs.statSync(basePython).isFile()) {
    throw new Error("The explicit base CPython interpreter is unavailable.");
  }
  const entryStats = fs.lstatSync(basePython);
  if (process.platform === "win32" && entryStats.isSymbolicLink()) {
    throw new Error("The explicit base CPython interpreter must be a regular file.");
  }
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-renderer-base-"));
  try {
    const environment = sanitizedPythonEnvironment({
      python: basePython,
      tempRoot: probeRoot,
      network: false,
    });
    const probe = JSON.parse(runChecked(
      basePython,
      [
        "-I",
        "-c",
        "import json,os,sys;print(json.dumps({'implementation':sys.implementation.name,'version':list(sys.version_info[:3]),'executable':os.path.abspath(sys.executable),'prefix':os.path.abspath(sys.prefix),'base_prefix':os.path.abspath(sys.base_prefix)}))",
      ],
      {
        cwd: REPOSITORY_ROOT,
        env: environment,
        spawn: options.spawn,
        label: "Base CPython probe",
      },
    ));
    if (probe.implementation !== "cpython" || probe.version?.[0] !== 3 || probe.version?.[1] !== 13) {
      throw new Error("renderer:bootstrap requires an explicit CPython 3.13 installation.");
    }
    if (!entryPathsEqual(probe.executable, basePython, options.platform || process.platform)) {
      throw new Error("renderer:bootstrap did not preserve the explicit base interpreter provenance.");
    }
    if (!entryPathsEqual(probe.prefix, probe.base_prefix)) {
      throw new Error("renderer:bootstrap requires a base installation, not another virtual environment.");
    }
    return {
      basePython: path.resolve(basePython),
      basePrefix: probe.prefix,
      pythonVersion: probe.version.join("."),
    };
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
}

function assertBootstrapTarget(rootDir) {
  const root = path.resolve(rootDir);
  const target = rendererEnvironmentRoot(root);
  if (path.dirname(target) !== root || path.basename(target) !== RENDERER_ENVIRONMENT_NAME) {
    throw new Error("Pantheon refused an unanchored renderer environment target.");
  }
  if (fs.existsSync(target)) {
    const stats = fs.lstatSync(target);
    if (
      !stats.isDirectory()
      || stats.isSymbolicLink()
      || !entryPathsEqual(fs.realpathSync(target), target)
    ) {
      throw new Error("Pantheon refused to replace a non-directory renderer environment target.");
    }
  }
  return target;
}

function bootstrapRendererEnvironment(options = {}) {
  const rootDir = path.resolve(options.rootDir || REPOSITORY_ROOT);
  const contract = readRendererRequirements({ rootDir });
  const base = assertBasePython(options.basePython, options);
  const target = assertBootstrapTarget(rootDir);
  if (fs.existsSync(target) && options.recreate !== true) {
    const current = rendererReadiness({ rootDir, environment: {}, spawn: options.spawn });
    if (current.ready && entryPathsEqual(current.basePrefix, base.basePrefix)) {
      return { ...current, basePython: base.basePython, reused: true };
    }
  }
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: false, maxRetries: 50, retryDelay: 100 });
  }
  const bootstrapRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-renderer-bootstrap-"));
  let complete = false;
  try {
    const baseEnvironment = sanitizedPythonEnvironment({
      python: base.basePython,
      tempRoot: bootstrapRoot,
      network: false,
    });
    runChecked(base.basePython, ["-I", "-m", "venv", target], {
      cwd: rootDir,
      env: baseEnvironment,
      spawn: options.spawn,
      timeout: 120_000,
      label: "Renderer virtual-environment creation",
    });
    const python = rendererPythonPath(rootDir);
    const installEnvironment = sanitizedPythonEnvironment({
      python,
      tempRoot: bootstrapRoot,
      network: true,
    });
    const installCache = path.join(target, ".pip-cache");
    installEnvironment.PIP_CACHE_DIR = installCache;
    runChecked(
      python,
      [
        "-I",
        "-m",
        "pip",
        "--isolated",
        "--disable-pip-version-check",
        "--no-input",
        "install",
        "--upgrade",
        "--no-deps",
        "--only-binary=:all:",
        "--index-url",
        "https://pypi.org/simple",
        "--cache-dir",
        installCache,
        "--requirement",
        contract.lockPath,
      ],
      {
        cwd: rootDir,
        env: installEnvironment,
        spawn: options.spawn,
        timeout: 5 * 60_000,
        label: "Renderer dependency installation",
      },
    );
    const validation = validateRendererEnvironment({
      rootDir,
      environment: {},
      spawn: options.spawn,
    });
    complete = true;
    return { ...validation, basePython: base.basePython, reused: false };
  } finally {
    fs.rmSync(bootstrapRoot, { recursive: true, force: true, maxRetries: 50, retryDelay: 100 });
    if (!complete && fs.existsSync(target)) {
      const anchored = assertBootstrapTarget(rootDir);
      fs.rmSync(anchored, { recursive: true, force: false, maxRetries: 50, retryDelay: 100 });
    }
  }
}

module.exports = {
  RENDERER_INVENTORY_DISTRIBUTIONS,
  RENDERER_LOCK_FILENAME,
  REQUIRED_DISTRIBUTIONS,
  REPOSITORY_ROOT,
  assertRendererEnvironment,
  bootstrapRendererEnvironment,
  entryPathsEqual,
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
};
