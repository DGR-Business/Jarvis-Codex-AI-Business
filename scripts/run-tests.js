const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const {
  LOCAL_ORDINARY_SHARD_COUNT,
  ordinaryTestWeight,
  planTestInvocations,
} = require("./test-shards");

const workspaceRoot = path.resolve(__dirname, "..");
const pdfTempRoot = path.join(workspaceRoot, "tmp", "pdfs");
const processIntegrationTests = new Set(["windows-launcher.test.js"]);
const RESTORED_BOOT_OS_ENVIRONMENT_ALLOWLIST = new Set([
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
]);
const TEST_PRIVACY_HASH_KEY = "test-only-privacy-hash-key-32-bytes";

function isInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function snapshotPdfTemp(source = pdfTempRoot, snapshot) {
  if (!snapshot) throw new Error("Pantheon requires a PDF snapshot path.");
  if (fs.existsSync(source)) fs.cpSync(source, snapshot, { recursive: true });
}

function restorePdfTemp(
  target = pdfTempRoot,
  snapshot,
  expectedParent = path.join(workspaceRoot, "tmp"),
) {
  if (!snapshot) throw new Error("Pantheon requires a PDF snapshot path.");
  if (!isInside(expectedParent, target)) {
    throw new Error("Refusing to clean an unexpected PDF temp path.");
  }
  fs.rmSync(target, { recursive: true, force: true });
  if (fs.existsSync(snapshot)) fs.cpSync(snapshot, target, { recursive: true });
}

function environmentEntry(environment, requestedName) {
  const upperName = requestedName.toUpperCase();
  return Object.entries(environment || {}).find(([name]) => name.toUpperCase() === upperName);
}

function environmentValue(environment, requestedName) {
  return environmentEntry(environment, requestedName)?.[1];
}

function copyAllowedOsEnvironment(parentEnvironment) {
  const selected = {};
  const copied = new Set();
  for (const [name, value] of Object.entries(parentEnvironment || {})) {
    const upperName = name.toUpperCase();
    if (
      RESTORED_BOOT_OS_ENVIRONMENT_ALLOWLIST.has(upperName)
      && !copied.has(upperName)
    ) {
      selected[name] = value;
      copied.add(upperName);
    }
  }
  return selected;
}

function comparablePath(value) {
  let resolved;
  try {
    resolved = fs.realpathSync(value);
  } catch {
    resolved = path.resolve(value);
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function pathsEquivalent(first, second) {
  return comparablePath(first) === comparablePath(second);
}

function minimalToolPath(parentEnvironment, rendererPython = null) {
  const candidates = [path.dirname(process.execPath)];
  const systemRoot = environmentValue(parentEnvironment, "SYSTEMROOT")
    || environmentValue(parentEnvironment, "WINDIR");
  const systemDrive = environmentValue(parentEnvironment, "SYSTEMDRIVE")
    || (systemRoot ? path.parse(systemRoot).root.replace(/[\\/]$/, "") : null);
  if (process.platform === "win32") {
    if (systemRoot && path.isAbsolute(systemRoot)) {
      candidates.push(
        systemRoot,
        path.join(systemRoot, "System32"),
        path.join(systemRoot, "System32", "Wbem"),
        path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0"),
      );
    }
    if (systemDrive && path.isAbsolute(`${systemDrive}\\`)) {
      candidates.push(
        path.join(`${systemDrive}\\`, "Program Files", "Git", "cmd"),
        path.join(`${systemDrive}\\`, "Program Files", "Git", "bin"),
        path.join(`${systemDrive}\\`, "Program Files", "nodejs"),
      );
    }
  } else {
    candidates.push("/usr/local/bin", "/usr/bin", "/bin");
  }
  const githubPythonRoot = environmentValue(parentEnvironment, "pythonLocation");
  if (
    environmentValue(parentEnvironment, "GITHUB_ACTIONS") === "true"
    && githubPythonRoot
    && path.isAbsolute(githubPythonRoot)
  ) {
    candidates.push(githubPythonRoot);
  }
  if (rendererPython) candidates.push(path.dirname(rendererPython));

  const directories = [];
  const seen = new Set();
  for (const candidate of candidates) {
    try {
      const canonical = fs.realpathSync(candidate);
      if (!fs.statSync(canonical).isDirectory()) continue;
      const key = comparablePath(canonical);
      if (!seen.has(key)) {
        directories.push(canonical);
        seen.add(key);
      }
    } catch {
      // Missing optional tool directories are deliberately omitted.
    }
  }
  return directories.join(path.delimiter);
}

function isHostedLifecycleEnvironment(environment) {
  const workspace = environmentValue(environment, "GITHUB_WORKSPACE");
  return environmentValue(environment, "CI") === "true"
    && environmentValue(environment, "GITHUB_ACTIONS") === "true"
    && environmentValue(environment, "RUNNER_OS") === "Windows"
    && Boolean(workspace)
    && pathsEquivalent(workspace, workspaceRoot);
}

function testModeFromEnvironment(environment = process.env, args = []) {
  const ci = environmentValue(environment, "CI") === "true";
  const lifecycleFlag = environmentValue(environment, "PANTHEON_LIFECYCLE_CI") === "1";
  const lifecycleTarget = args.length === 1
    && args[0].replace(/\\/g, "/") === "test/windows-launcher.test.js";
  const hostedLifecycle = lifecycleFlag && isHostedLifecycleEnvironment(environment);
  if (hostedLifecycle && !lifecycleTarget) {
    throw new Error(
      "Hosted Windows lifecycle mode requires the exact quarantined lifecycle test target.",
    );
  }
  const lifecycleCi = hostedLifecycle && lifecycleTarget;
  const lifecyclePhase = lifecycleCi
    ? String(environmentValue(environment, "PANTHEON_LIFECYCLE_PHASE") || "all")
    : null;
  if (lifecycleCi && !["all", "containment", "repeat"].includes(lifecyclePhase)) {
    throw new Error(`Unsupported Windows lifecycle phase: ${lifecyclePhase}`);
  }
  return { ci, lifecycleCi, lifecyclePhase };
}

function requestedTestInvocations(args, parentEnvironment = process.env, suppliedMode = null) {
  const { ci, lifecycleCi } = suppliedMode || testModeFromEnvironment(parentEnvironment, args);
  const requested = args.length
    ? args.map((value) => {
      const normalized = value.replace(/\\/g, "/");
      if (!/^test\/[a-zA-Z0-9._-]+\.test\.js$/.test(normalized)) {
        throw new Error(`Unsupported test path: ${value}`);
      }
      return normalized;
    })
    : fs.readdirSync(path.join(workspaceRoot, "test"))
      .filter((name) => name.endsWith(".test.js"))
      .sort()
      .map((name) => `test/${name}`);
  const processTests = requested.filter((value) => (
    processIntegrationTests.has(path.basename(value))
  ));
  if (args.length && processTests.length && !lifecycleCi) {
    throw new Error(
      "Windows lifecycle integration is quarantined from local and ordinary test runs. "
      + "It runs only in the disposable, externally bounded CI lifecycle job.",
    );
  }
  const runnable = requested.filter((value) => {
    const normalized = value.replace(/\\/g, "/");
    return lifecycleCi || !processIntegrationTests.has(path.basename(normalized));
  });
  const ordinaryCi = ci && !lifecycleCi && !args.length;
  let shardCount = 1;
  let shardIndex = 0;
  if (ordinaryCi) {
    shardCount = Number(environmentValue(parentEnvironment, "PANTHEON_TEST_SHARD_COUNT") || 1);
    shardIndex = Number(environmentValue(parentEnvironment, "PANTHEON_TEST_SHARD_INDEX") || 0);
    if (
      !Number.isInteger(shardCount)
      || shardCount < 1
      || !Number.isInteger(shardIndex)
      || shardIndex < 0
      || shardIndex >= shardCount
    ) {
      throw new Error("Pantheon received an invalid CI test-shard configuration.");
    }
  }
  return planTestInvocations(
    runnable,
    {
      explicit: args.length > 0,
      ci: ordinaryCi,
      lifecycleCi,
      shardCount,
      shardIndex,
      localShardCount: LOCAL_ORDINARY_SHARD_COUNT,
    },
    (value) => ordinaryTestWeight(
      value,
      fs.statSync(path.join(workspaceRoot, value)).size,
    ),
  );
}

function pythonPathCandidates(parentEnvironment) {
  const candidates = [];
  const preferred = environmentValue(parentEnvironment, "PANTHEON_PYTHON");
  const legacy = environmentValue(parentEnvironment, "JARVIS_PYTHON");
  if (
    preferred
    && legacy
    && path.isAbsolute(preferred)
    && path.isAbsolute(legacy)
    && pathsEquivalent(preferred, legacy)
  ) {
    candidates.push(preferred);
  }

  const dependencyRoot = path.resolve(path.dirname(process.execPath), "..", "..");
  candidates.push(path.join(
    dependencyRoot,
    "python",
    process.platform === "win32" ? "python.exe" : "python",
  ));
  for (const homeName of ["USERPROFILE", "HOME"]) {
    const home = environmentValue(parentEnvironment, homeName);
    if (home) {
      candidates.push(path.join(
        home,
        ".cache",
        "codex-runtimes",
        "codex-primary-runtime",
        "dependencies",
        "python",
        process.platform === "win32" ? "python.exe" : "python",
      ));
    }
  }
  const githubPythonRoot = environmentValue(parentEnvironment, "pythonLocation");
  if (
    environmentValue(parentEnvironment, "GITHUB_ACTIONS") === "true"
    && githubPythonRoot
    && path.isAbsolute(githubPythonRoot)
  ) {
    candidates.push(path.join(
      githubPythonRoot,
      process.platform === "win32" ? "python.exe" : "bin/python",
    ));
  }
  const seen = new Set();
  return candidates
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => {
      const key = comparablePath(candidate);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function rendererPythonReady(candidate, parentEnvironment, rootDir = workspaceRoot) {
  const executablePattern = process.platform === "win32"
    ? /^python(?:3(?:\.\d+)*)?\.exe$/i
    : /^python(?:3(?:\.\d+)*)?$/;
  if (!executablePattern.test(path.basename(candidate))) return null;
  let probeRoot = null;
  try {
    const canonical = fs.realpathSync(candidate);
    if (!fs.statSync(canonical).isFile()) return null;
    probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-renderer-probe-"));
    const profileRoot = path.join(probeRoot, "profile");
    const tempRoot = path.join(probeRoot, "temp");
    fs.mkdirSync(profileRoot, { recursive: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    const probeEnvironment = {
      ...copyAllowedOsEnvironment(parentEnvironment),
      HOME: profileRoot,
      PATH: minimalToolPath(parentEnvironment, canonical),
      PYTHONNOUSERSITE: "1",
      PYTHONDONTWRITEBYTECODE: "1",
      TEMP: tempRoot,
      TMP: tempRoot,
      TMPDIR: tempRoot,
      USERPROFILE: profileRoot,
    };
    const result = spawnSync(
      canonical,
      ["-c", "import openpyxl,PIL,pypdfium2,reportlab"],
      {
        cwd: probeRoot || rootDir,
        env: probeEnvironment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 20_000,
      },
    );
    return result.status === 0 ? canonical : null;
  } catch {
    return null;
  } finally {
    if (probeRoot) {
      fs.rmSync(probeRoot, {
        recursive: true,
        force: true,
        maxRetries: 50,
        retryDelay: 100,
      });
    }
  }
}

function resolveRendererPython(parentEnvironment = process.env, rootDir = workspaceRoot) {
  for (const candidate of pythonPathCandidates(parentEnvironment)) {
    const ready = rendererPythonReady(candidate, parentEnvironment, rootDir);
    if (ready) return ready;
  }
  return null;
}

function assignCurrentAndLegacy(environment, suffix, value) {
  environment[`PANTHEON_${suffix}`] = value;
  environment[`JARVIS_${suffix}`] = value;
}

function createTestEnvironment({
  parentEnvironment = process.env,
  runtimeRoot,
  mode = testModeFromEnvironment(parentEnvironment),
  rendererPython = null,
}) {
  const resolvedRoot = path.resolve(runtimeRoot);
  const isolatedTempRoot = path.join(resolvedRoot, "os-temp");
  const profileRoot = path.join(resolvedRoot, "profile");
  const dataRoot = path.join(resolvedRoot, "data");
  const environment = {
    ...copyAllowedOsEnvironment(parentEnvironment),
    APPDATA: path.join(profileRoot, "AppData", "Roaming"),
    HOME: profileRoot,
    LOCALAPPDATA: path.join(profileRoot, "AppData", "Local"),
    NODE_ENV: "test",
    NPM_CONFIG_CACHE: path.join(resolvedRoot, "npm-cache"),
    NPM_CONFIG_USERCONFIG: path.join(resolvedRoot, "npmrc"),
    PATH: minimalToolPath(parentEnvironment, rendererPython),
    PANTHEON_LIFECYCLE_CI: mode.lifecycleCi ? "1" : "0",
    PANTHEON_TEST_RUNTIME_ROOT: resolvedRoot,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
    TEMP: isolatedTempRoot,
    TMP: isolatedTempRoot,
    TMPDIR: isolatedTempRoot,
    USERPROFILE: profileRoot,
    XDG_CACHE_HOME: path.join(profileRoot, ".cache"),
    XDG_CONFIG_HOME: path.join(profileRoot, ".config"),
    XDG_DATA_HOME: path.join(profileRoot, ".local", "share"),
  };
  if (mode.ci) environment.CI = "true";
  if (mode.lifecycleCi) environment.PANTHEON_LIFECYCLE_PHASE = mode.lifecyclePhase;
  if (rendererPython) assignCurrentAndLegacy(environment, "PYTHON", rendererPython);

  assignCurrentAndLegacy(environment, "DATA_DIR", dataRoot);
  assignCurrentAndLegacy(environment, "DB_PATH", path.join(dataRoot, "runtime.sqlite"));
  assignCurrentAndLegacy(environment, "ARTIFACT_ROOT", path.join(resolvedRoot, "artifacts"));
  assignCurrentAndLegacy(environment, "APPROVAL_PACK_DIR", path.join(resolvedRoot, "approval-packs"));
  assignCurrentAndLegacy(environment, "BACKUP_DESTINATION", path.join(resolvedRoot, "backups"));
  assignCurrentAndLegacy(environment, "CREDENTIAL_ROOT", path.join(resolvedRoot, "credentials"));
  assignCurrentAndLegacy(environment, "LAUNCHER_STATE_ROOT", path.join(resolvedRoot, "launcher"));
  assignCurrentAndLegacy(environment, "PRIVATE_OPERATOR_DIR", path.join(resolvedRoot, "private"));
  assignCurrentAndLegacy(environment, "RUNTIME_METADATA_PATH", path.join(resolvedRoot, "runtime", "metadata.json"));
  assignCurrentAndLegacy(environment, "ASSURANCE_PROOF_ROOT", path.join(resolvedRoot, "assurance"));
  assignCurrentAndLegacy(environment, "PRIVACY_HASH_KEY", TEST_PRIVACY_HASH_KEY);
  assignCurrentAndLegacy(environment, "API_CREDIT_AUD_PER_USD", "2");
  assignCurrentAndLegacy(environment, "LIVE_MODE", "0");
  assignCurrentAndLegacy(environment, "SCHEDULER_ENABLED", "1");
  assignCurrentAndLegacy(environment, "SYSTEM_PROOF_MODE", "0");
  environment.PANTHEON_CONTROL_JOURNEY_REHEARSAL = "0";

  for (const directory of [
    isolatedTempRoot,
    profileRoot,
    environment.APPDATA,
    environment.LOCALAPPDATA,
    dataRoot,
  ]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  return environment;
}

function testDeadlineMs(mode) {
  if (mode.lifecycleCi) return 9 * 60_000;
  return mode.ci ? 12 * 60_000 : 4 * 60_000;
}

function runTests(
  args = process.argv.slice(2),
  parentEnvironment = process.env,
  dependencies = {},
) {
  const mode = testModeFromEnvironment(parentEnvironment, args);
  const invocations = requestedTestInvocations(args, parentEnvironment, mode);
  const rendererResolver = dependencies.resolveRendererPython || resolveRendererPython;
  const rendererPython = rendererResolver(parentEnvironment);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-test-runtime-"));
  const pdfSnapshot = path.join(root, "pre-test-pdfs");
  try {
    snapshotPdfTemp(pdfTempRoot, pdfSnapshot);
    const deadline = testDeadlineMs(mode);
    for (let index = 0; index < invocations.length; index += 1) {
      const files = invocations[index];
      if (invocations.length > 1) {
        process.stdout.write(
          `Pantheon local ordinary tests: shard ${index + 1}/${invocations.length} (${files.length} files).\n`,
        );
      }
      const nodeTestArguments = [
        "--test",
        "--test-isolation=none",
        ...(mode.lifecycleCi ? ["--test-concurrency=1"] : []),
        ...files,
      ];
      const invocationRoot = path.join(root, `invocation-${index + 1}`);
      const environment = createTestEnvironment({
        parentEnvironment,
        runtimeRoot: invocationRoot,
        mode,
        rendererPython,
      });
      const result = spawnSync(
        process.execPath,
        nodeTestArguments,
        {
          cwd: workspaceRoot,
          env: environment,
          stdio: "inherit",
          windowsHide: true,
          timeout: deadline,
          killSignal: "SIGKILL",
        },
      );
      if (result.error?.code === "ETIMEDOUT") {
        throw new Error(
          `The ${mode.lifecycleCi ? "Windows lifecycle" : "ordinary"} test process exceeded its external deadline.`,
        );
      }
      if (result.error) throw result.error;
      if (result.status !== 0) {
        process.exitCode = result.status ?? 1;
        break;
      }
    }
  } finally {
    restorePdfTemp(pdfTempRoot, pdfSnapshot);
    fs.rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 50,
      retryDelay: 100,
    });
  }
}

if (require.main === module) {
  try {
    runTests();
  } catch (error) {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  RESTORED_BOOT_OS_ENVIRONMENT_ALLOWLIST,
  TEST_PRIVACY_HASH_KEY,
  createTestEnvironment,
  isInside,
  pythonPathCandidates,
  requestedTestInvocations,
  resolveRendererPython,
  restorePdfTemp,
  runTests,
  snapshotPdfTemp,
  testDeadlineMs,
  testModeFromEnvironment,
};
