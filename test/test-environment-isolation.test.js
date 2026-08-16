const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  TEST_PRIVACY_HASH_KEY,
  createTestEnvironment,
  isInside,
  requestedTestInvocations,
  resolveRendererPython,
  restorePdfTemp,
  runTests,
  snapshotPdfTemp,
  testDeadlineMs,
  testModeFromEnvironment,
} = require("../scripts/run-tests");

const workspaceRoot = path.resolve(__dirname, "..");

function valueFor(environment, name) {
  const expected = name.toUpperCase();
  return Object.entries(environment).find(([key]) => key.toUpperCase() === expected)?.[1];
}

function directorySnapshot(root) {
  const digest = crypto.createHash("sha256");
  let entries = 0;
  if (!fs.existsSync(root)) {
    digest.update("missing\0");
    return { entries, digest: digest.digest("hex") };
  }
  function visit(current) {
    const children = fs.readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of children) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute).replaceAll("\\", "/");
      entries += 1;
      if (entry.isDirectory()) {
        digest.update(`directory\0${relative}\0`);
        visit(absolute);
      } else {
        const contents = fs.readFileSync(absolute);
        digest.update(`file\0${relative}\0${contents.length}\0`);
        digest.update(contents);
        digest.update("\0");
      }
    }
  }
  visit(root);
  return { entries, digest: digest.digest("hex") };
}

test("ordinary children receive only deliberate tools, controls, and disposable paths", () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-env-contract-"));
  const outside = path.resolve(runtimeRoot, "..", "owner-state-sentinel");
  const secret = "synthetic-owner-secret-must-not-cross";
  const rendererPython = path.join(runtimeRoot, "validated-renderer", "python.exe");
  const hostileToolRoot = path.join(runtimeRoot, "hostile-tools");
  const coherentHostileRoot = path.join(runtimeRoot, "coherent-hostile-windows");
  const systemRoot = valueFor(process.env, "SYSTEMROOT") || "C:\\Windows";
  fs.mkdirSync(hostileToolRoot, { recursive: true });
  const parentEnvironment = {
    ComSpec: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
    Path: hostileToolRoot,
    PATHEXT: `.${secret}.EXE`,
    SystemDrive: valueFor(process.env, "SYSTEMDRIVE")
      || path.parse(systemRoot).root.replace(/[\\/]$/, ""),
    SystemRoot: systemRoot,
    windir: valueFor(process.env, "WINDIR") || systemRoot,
    OPENAI_API_KEY: secret,
    CLICKUP_API_TOKEN: secret,
    GELATO_API_KEY: secret,
    SLACK_BOT_TOKEN: secret,
    XERO_CLIENT_ID: secret,
    PANTHEON_BACKUP_PASSPHRASE: secret,
    JARVIS_BACKUP_PASSPHRASE: secret,
    PANTHEON_CONTROL_TOKEN: secret,
    JARVIS_CONTROL_TOKEN: secret,
    PANTHEON_OPERATOR_BOOTSTRAP: secret,
    JARVIS_OPERATOR_BOOTSTRAP: secret,
    PANTHEON_RUNTIME_INSTANCE_ID: secret,
    JARVIS_RUNTIME_INSTANCE_ID: secret,
    PANTHEON_DATA_DIR: outside,
    JARVIS_DATA_DIR: outside,
    PANTHEON_DB_PATH: outside,
    JARVIS_DB_PATH: outside,
    PANTHEON_ARTIFACT_ROOT: outside,
    JARVIS_ARTIFACT_ROOT: outside,
    PANTHEON_PROOF_LEDGER_PATH: outside,
    JARVIS_PROOF_LEDGER_PATH: outside,
    PANTHEON_PRIVACY_HASH_KEY: secret,
    JARVIS_PRIVACY_HASH_KEY: secret,
    PANTHEON_PYTHON: outside,
    JARVIS_PYTHON: outside,
    PANTHEON_LIVE_MODE: "1",
    JARVIS_LIVE_MODE: "1",
    PANTHEON_ENABLE_LIVE_MODELS: "1",
    JARVIS_ENABLE_LIVE_MODELS: "1",
    PANTHEON_ENABLE_LIVE_RESEARCH: "1",
    JARVIS_ENABLE_LIVE_RESEARCH: "1",
    PANTHEON_ENABLE_IMAGE_GENERATION: "1",
    JARVIS_ENABLE_IMAGE_GENERATION: "1",
    PANTHEON_LIFECYCLE_CI: "1",
    PANTHEON_LIFECYCLE_PHASE: "repeat",
    PANTHEON_CONTROL_JOURNEY_REHEARSAL: "1",
    NODE_OPTIONS: `--require=${outside}`,
    NODE_PATH: outside,
    NODE_EXTRA_CA_CERTS: outside,
    NODE_TLS_REJECT_UNAUTHORIZED: "0",
    PYTHONHOME: outside,
    PYTHONPATH: outside,
    HOME: outside,
    USERPROFILE: outside,
    APPDATA: outside,
    LOCALAPPDATA: outside,
    HTTP_PROXY: `http://${secret}.invalid`,
    HTTPS_PROXY: `http://${secret}.invalid`,
    PORT: "443",
    PANTHEON_WORKING_PORT: "443",
    CI: "false",
  };

  try {
    if (process.platform === "win32") {
      const coherentHostileSystem32 = path.join(coherentHostileRoot, "System32");
      const coherentHostileComSpec = path.join(coherentHostileSystem32, "cmd.exe");
      fs.mkdirSync(
        path.join(coherentHostileSystem32, "WindowsPowerShell", "v1.0"),
        { recursive: true },
      );
      fs.mkdirSync(path.join(coherentHostileSystem32, "Wbem"), { recursive: true });
      fs.writeFileSync(coherentHostileComSpec, "synthetic hostile executable");
      assert.throws(
        () => createTestEnvironment({
          parentEnvironment: { ...parentEnvironment, ComSpec: outside },
          runtimeRoot,
          mode: { ci: false, lifecycleCi: false, lifecyclePhase: null },
        }),
        /inconsistent Windows system-tool inputs/,
      );
      assert.throws(
        () => createTestEnvironment({
          parentEnvironment: { ...parentEnvironment, SystemDrive: "Z:" },
          runtimeRoot,
          mode: { ci: false, lifecycleCi: false, lifecyclePhase: null },
        }),
        /inconsistent Windows system-tool inputs/,
      );
      assert.throws(
        () => createTestEnvironment({
          parentEnvironment: { ...parentEnvironment, SystemRoot: outside },
          runtimeRoot,
          mode: { ci: false, lifecycleCi: false, lifecyclePhase: null },
        }),
        /inconsistent Windows system-tool inputs/,
      );
      assert.throws(
        () => createTestEnvironment({
          parentEnvironment: {
            ...parentEnvironment,
            ComSpec: coherentHostileComSpec,
            SystemDrive: path.parse(coherentHostileRoot).root.replace(/[\\/]$/, ""),
            SystemRoot: coherentHostileRoot,
            windir: coherentHostileRoot,
          },
          runtimeRoot,
          mode: { ci: false, lifecycleCi: false, lifecyclePhase: null },
        }),
        /inconsistent Windows system-tool inputs/,
      );
    }

    const mode = testModeFromEnvironment(parentEnvironment);
    const child = createTestEnvironment({
      parentEnvironment,
      runtimeRoot,
      mode,
      rendererPython,
    });

    assert.deepEqual(mode, { ci: false, lifecycleCi: false, lifecyclePhase: null });
    assert.notEqual(valueFor(child, "PATH"), valueFor(parentEnvironment, "PATH"));
    assert.equal(valueFor(child, "PATH").split(path.delimiter).includes(hostileToolRoot), false);
    if (process.platform === "win32") {
      assert.equal(valueFor(child, "PATHEXT"), ".COM;.EXE;.BAT;.CMD");
      assert.equal(String(valueFor(child, "ComSpec")).includes(coherentHostileRoot), false);
      assert.equal(
        valueFor(child, "PATH").split(path.delimiter).includes(coherentHostileRoot),
        false,
      );
    }
    assert.equal(child.PANTHEON_PYTHON, rendererPython);
    assert.equal(child.JARVIS_PYTHON, rendererPython);
    assert.equal(child.PANTHEON_PRIVACY_HASH_KEY, TEST_PRIVACY_HASH_KEY);
    assert.equal(child.JARVIS_PRIVACY_HASH_KEY, TEST_PRIVACY_HASH_KEY);
    assert.equal(child.PANTHEON_LIVE_MODE, "0");
    assert.equal(child.JARVIS_ENABLE_LIVE_RESEARCH, undefined);
    assert.equal(child.PANTHEON_CONTROL_JOURNEY_REHEARSAL, "0");
    assert.equal(child.CI, undefined);
    assert.equal(child.PANTHEON_LIFECYCLE_CI, "0");
    assert.equal(child.PANTHEON_LIFECYCLE_PHASE, undefined);
    assert.equal(child.PANTHEON_SCHEDULER_ENABLED, "1");
    assert.equal(child.JARVIS_SCHEDULER_ENABLED, "1");
    assert.equal(child.PANTHEON_PROOF_LEDGER_PATH, undefined);
    assert.equal(child.JARVIS_PROOF_LEDGER_PATH, undefined);

    for (const name of [
      "OPENAI_API_KEY",
      "CLICKUP_API_TOKEN",
      "GELATO_API_KEY",
      "SLACK_BOT_TOKEN",
      "XERO_CLIENT_ID",
      "PANTHEON_BACKUP_PASSPHRASE",
      "JARVIS_BACKUP_PASSPHRASE",
      "PANTHEON_CONTROL_TOKEN",
      "JARVIS_CONTROL_TOKEN",
      "PANTHEON_OPERATOR_BOOTSTRAP",
      "JARVIS_OPERATOR_BOOTSTRAP",
      "PANTHEON_RUNTIME_INSTANCE_ID",
      "JARVIS_RUNTIME_INSTANCE_ID",
      "PANTHEON_ENABLE_LIVE_MODELS",
      "JARVIS_ENABLE_LIVE_MODELS",
      "PANTHEON_ENABLE_LIVE_RESEARCH",
      "JARVIS_ENABLE_LIVE_RESEARCH",
      "PANTHEON_ENABLE_IMAGE_GENERATION",
      "JARVIS_ENABLE_IMAGE_GENERATION",
      "NODE_OPTIONS",
      "NODE_PATH",
      "NODE_EXTRA_CA_CERTS",
      "NODE_TLS_REJECT_UNAUTHORIZED",
      "PYTHONHOME",
      "PYTHONPATH",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "PORT",
      "PANTHEON_WORKING_PORT",
    ]) {
      assert.equal(valueFor(child, name), undefined, name);
    }
    assert.equal(Object.values(child).some((value) => String(value).includes(secret)), false);
    assert.equal(Object.values(child).some((value) => String(value).includes(outside)), false);

    for (const name of [
      "TEMP",
      "TMP",
      "TMPDIR",
      "HOME",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "NPM_CONFIG_CACHE",
      "NPM_CONFIG_USERCONFIG",
      "XDG_CACHE_HOME",
      "XDG_CONFIG_HOME",
      "XDG_DATA_HOME",
      "PANTHEON_TEST_RUNTIME_ROOT",
      "PANTHEON_DATA_DIR",
      "JARVIS_DATA_DIR",
      "PANTHEON_DB_PATH",
      "JARVIS_DB_PATH",
      "PANTHEON_ARTIFACT_ROOT",
      "JARVIS_ARTIFACT_ROOT",
      "PANTHEON_APPROVAL_PACK_DIR",
      "JARVIS_APPROVAL_PACK_DIR",
      "PANTHEON_BACKUP_DESTINATION",
      "JARVIS_BACKUP_DESTINATION",
      "PANTHEON_CREDENTIAL_ROOT",
      "JARVIS_CREDENTIAL_ROOT",
      "PANTHEON_LAUNCHER_STATE_ROOT",
      "JARVIS_LAUNCHER_STATE_ROOT",
      "PANTHEON_PRIVATE_OPERATOR_DIR",
      "JARVIS_PRIVATE_OPERATOR_DIR",
      "PANTHEON_RUNTIME_METADATA_PATH",
      "JARVIS_RUNTIME_METADATA_PATH",
      "PANTHEON_ASSURANCE_PROOF_ROOT",
      "JARVIS_ASSURANCE_PROOF_ROOT",
    ]) {
      assert.equal(isInside(runtimeRoot, child[name]), true, name);
    }

    const forbiddenNames = [
      "OPENAI_API_KEY",
      "PANTHEON_CONTROL_TOKEN",
      "NODE_OPTIONS",
      "NODE_PATH",
      "PANTHEON_PROOF_LEDGER_PATH",
      "JARVIS_PROOF_LEDGER_PATH",
    ];
    const childProbe = spawnSync(
      process.execPath,
      [
        "-e",
        "const names=JSON.parse(process.argv[1]);"
          + "if(names.some((name)=>process.env[name]!==undefined))process.exit(17);",
        JSON.stringify(forbiddenNames),
      ],
      {
        cwd: workspaceRoot,
        env: child,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      },
    );
    assert.equal(childProbe.status, 0, childProbe.stderr || childProbe.stdout);

    const gitProbe = spawnSync("git", ["--version"], {
      cwd: workspaceRoot,
      env: child,
      encoding: "utf8",
      windowsHide: true,
      timeout: 10_000,
    });
    assert.equal(gitProbe.status, 0, gitProbe.stderr || gitProbe.stdout);
    assert.match(gitProbe.stdout, /^git version /);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("proof ledgers retain the production DB-relative fallback inside disposable roots", () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-proof-fallback-"));
  try {
    const environment = createTestEnvironment({
      parentEnvironment: process.env,
      runtimeRoot,
      mode: { ci: false, lifecycleCi: false, lifecyclePhase: null },
      rendererPython: null,
    });
    const firstDb = path.join(environment.TEMP, "runtime-a", "runtime.sqlite");
    const secondDb = path.join(environment.TEMP, "runtime-b", "runtime.sqlite");
    const script = [
      "const {proofExposureLedgerPath}=require('./src/runtime/proof-exposure-ledger');",
      "const fake=(file)=>({prepare:()=>({all:()=>[{name:'main',file}]})});",
      "process.stdout.write(JSON.stringify(process.argv.slice(1).map((file)=>proofExposureLedgerPath(fake(file)))));",
    ].join("");
    const result = spawnSync(
      process.execPath,
      ["-e", script, firstDb, secondDb],
      {
        cwd: workspaceRoot,
        env: environment,
        encoding: "utf8",
        windowsHide: true,
        timeout: 10_000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const ledgers = JSON.parse(result.stdout);
    assert.equal(ledgers.length, 2);
    assert.notEqual(ledgers[0], ledgers[1]);
    assert.ok(ledgers.every((ledger) => isInside(runtimeRoot, ledger)));
    assert.ok(ledgers.every((ledger) => path.basename(ledger) === "proof-exposure.sqlite"));
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }
});

test("local, ordinary CI, and hosted lifecycle modes retain their bounds", () => {
  const local = testModeFromEnvironment({
    CI: "false",
    PANTHEON_LIFECYCLE_CI: "1",
    PANTHEON_LIFECYCLE_PHASE: "repeat",
  });
  const ci = testModeFromEnvironment({ CI: "true", PANTHEON_LIFECYCLE_CI: "0" });
  const hostedLifecycleEnvironment = {
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_WORKSPACE: workspaceRoot,
    PANTHEON_LIFECYCLE_CI: "1",
    PANTHEON_LIFECYCLE_PHASE: "containment",
    RUNNER_OS: "Windows",
    npm_lifecycle_event: "test:lifecycle:ci",
    npm_lifecycle_script: "node scripts/run-tests.js test/windows-launcher.test.js",
  };
  const lifecycle = testModeFromEnvironment(
    hostedLifecycleEnvironment,
    ["test/windows-launcher.test.js"],
  );

  assert.deepEqual(local, { ci: false, lifecycleCi: false, lifecyclePhase: null });
  assert.deepEqual(ci, { ci: true, lifecycleCi: false, lifecyclePhase: null });
  assert.deepEqual(lifecycle, {
    ci: true,
    lifecycleCi: true,
    lifecyclePhase: "containment",
  });
  assert.equal(testDeadlineMs(local), 4 * 60_000);
  assert.equal(testDeadlineMs(ci), 12 * 60_000);
  assert.equal(testDeadlineMs(lifecycle), 9 * 60_000);
  assert.throws(
    () => testModeFromEnvironment({
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_WORKSPACE: workspaceRoot,
      PANTHEON_LIFECYCLE_CI: "1",
      PANTHEON_LIFECYCLE_PHASE: "unsafe",
      RUNNER_OS: "Windows",
      npm_lifecycle_event: "test:lifecycle:ci",
      npm_lifecycle_script: "node scripts/run-tests.js test/windows-launcher.test.js",
    }, ["test/windows-launcher.test.js"]),
    /Unsupported Windows lifecycle phase/,
  );
  assert.throws(
    () => testModeFromEnvironment(hostedLifecycleEnvironment, []),
    /requires the exact quarantined lifecycle test target/,
  );

  assert.deepEqual(
    requestedTestInvocations(["test/runtime.test.js"], {}),
    [["test/runtime.test.js"]],
  );
  assert.throws(
    () => requestedTestInvocations(["test/support/nested.test.js"], {}),
    /Unsupported test path/,
  );
  assert.throws(
    () => requestedTestInvocations(["test/windows-launcher.test.js"], {}),
    /Windows lifecycle integration is quarantined/,
  );
  const lifecycleFlagsWithoutExactCommand = { ...hostedLifecycleEnvironment };
  delete lifecycleFlagsWithoutExactCommand.npm_lifecycle_event;
  delete lifecycleFlagsWithoutExactCommand.npm_lifecycle_script;
  assert.throws(
    () => requestedTestInvocations(
      ["test/windows-launcher.test.js"],
      lifecycleFlagsWithoutExactCommand,
    ),
    /Windows lifecycle integration is quarantined/,
  );
  assert.throws(
    () => requestedTestInvocations([], hostedLifecycleEnvironment),
    /requires the exact quarantined lifecycle test target/,
  );
  assert.throws(
    () => requestedTestInvocations(
      ["test/runtime.test.js"],
      hostedLifecycleEnvironment,
    ),
    /requires the exact quarantined lifecycle test target/,
  );
  assert.deepEqual(
    requestedTestInvocations(
      ["test/windows-launcher.test.js"],
      hostedLifecycleEnvironment,
    ),
    [["test/windows-launcher.test.js"]],
  );

  let rendererProbed = false;
  assert.throws(
    () => runTests(
      ["test/support/nested.test.js"],
      {},
      {
        resolveRendererPython() {
          rendererProbed = true;
          return null;
        },
      },
    ),
    /Unsupported test path/,
  );
  assert.equal(rendererProbed, false);
});

test("ordinary wrapper resolution accepts only the exact validated renderer boundary", () => {
  const canonical = resolveRendererPython(process.env, workspaceRoot);
  assert.ok(path.isAbsolute(canonical));
  assert.throws(
    () => resolveRendererPython({ PANTHEON_PYTHON: "relative-python" }, workspaceRoot),
    /must both be absent/i,
  );
  assert.throws(
    () => resolveRendererPython({
      PANTHEON_PYTHON: process.execPath,
      JARVIS_PYTHON: path.join(os.tmpdir(), "missing-renderer-python.exe"),
    }, workspaceRoot),
    /different interpreters/i,
  );

  const hostilePath = path.join(os.tmpdir(), "ambient-python-inputs-must-not-be-used");
  const hostileResolved = resolveRendererPython({
    ...process.env,
    HOME: hostilePath,
    PATH: hostilePath,
    USERPROFILE: hostilePath,
    pythonLocation: hostilePath,
  }, workspaceRoot);
  assert.equal(hostileResolved, canonical);
  assert.equal(
    isInside(hostilePath, hostileResolved),
    false,
  );
  assert.throws(
    () => resolveRendererPython({
      PANTHEON_PYTHON: process.execPath,
      JARVIS_PYTHON: process.execPath,
    }, workspaceRoot),
    /foreign renderer interpreter/i,
  );
});

test("ordinary hosted provenance is preserved, while lifecycle mode never probes Python", () => {
  const runtimeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-hosted-child-"));
  const canonicalRenderer = resolveRendererPython(process.env, workspaceRoot);
  const pythonLocation = path.join(runtimeRoot, "setup-python");
  const setupPython = process.platform === "win32"
    ? path.join(pythonLocation, "python.exe")
    : path.join(pythonLocation, "bin", "python");
  fs.mkdirSync(path.dirname(setupPython), { recursive: true });
  fs.writeFileSync(setupPython, "synthetic setup-python interpreter boundary\n");
  const hostedOrdinary = {
    ...process.env,
    CI: "true",
    GITHUB_ACTIONS: "true",
    GITHUB_WORKSPACE: workspaceRoot,
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux",
    pythonLocation,
  };
  try {
    const child = createTestEnvironment({
      parentEnvironment: hostedOrdinary,
      runtimeRoot,
      mode: { ci: true, lifecycleCi: false, lifecyclePhase: null },
      rendererPython: canonicalRenderer,
    });
    for (const name of ["GITHUB_ACTIONS", "GITHUB_WORKSPACE", "RUNNER_ENVIRONMENT", "RUNNER_OS", "pythonLocation"]) {
      assert.equal(child[name], hostedOrdinary[name]);
    }
    assert.equal(child.PANTHEON_PYTHON, canonicalRenderer);
    assert.equal(child.JARVIS_PYTHON, canonicalRenderer);
    assert.notEqual(child.PANTHEON_PYTHON, setupPython);
  } finally {
    fs.rmSync(runtimeRoot, { recursive: true, force: true });
  }

  if (process.platform === "win32") {
    let rendererProbed = false;
    const lifecycleEnvironment = {
      ...process.env,
      CI: "true",
      GITHUB_ACTIONS: "true",
      GITHUB_WORKSPACE: workspaceRoot,
      PANTHEON_LIFECYCLE_CI: "1",
      PANTHEON_LIFECYCLE_PHASE: "containment",
      RUNNER_OS: "Windows",
      npm_lifecycle_event: "test:lifecycle:ci",
      npm_lifecycle_script: "node scripts/run-tests.js test/windows-launcher.test.js",
    };
    runTests(
      ["test/windows-launcher.test.js"],
      lifecycleEnvironment,
      {
        resolveRendererPython() {
          rendererProbed = true;
          throw new Error("lifecycle must not probe renderer");
        },
        restorePdfTemp() {},
        snapshotPdfTemp() {},
        spawnTestProcess() { return { status: 0 }; },
      },
    );
    assert.equal(rendererProbed, false);
  }
});

test("PDF temp restoration and wrapper failure cleanup retain their boundaries", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-wrapper-cleanup-"));
  const syntheticWorkspace = path.join(sandbox, "workspace");
  const expectedParent = path.join(syntheticWorkspace, "tmp");
  const syntheticPdfRoot = path.join(expectedParent, "pdfs");
  const snapshot = path.join(sandbox, "snapshot");
  const realPdfRoot = path.join(workspaceRoot, "tmp", "pdfs");
  const realPdfBefore = directorySnapshot(realPdfRoot);
  const runtimePrefix = "pantheon-test-runtime-";
  const wrapperRootsBefore = new Set(
    fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(runtimePrefix)),
  );
  try {
    fs.mkdirSync(path.join(syntheticPdfRoot, "nested"), { recursive: true });
    fs.writeFileSync(path.join(syntheticPdfRoot, "baseline.txt"), "baseline");
    fs.writeFileSync(path.join(syntheticPdfRoot, "nested", "retained.txt"), "retained");
    snapshotPdfTemp(syntheticPdfRoot, snapshot);
    try {
      fs.writeFileSync(path.join(syntheticPdfRoot, "baseline.txt"), "changed");
      fs.writeFileSync(path.join(syntheticPdfRoot, "unexpected.txt"), "unexpected");
      throw new Error("synthetic child failure");
    } catch (error) {
      assert.match(error.message, /synthetic child failure/);
    } finally {
      restorePdfTemp(syntheticPdfRoot, snapshot, expectedParent);
    }
    assert.equal(fs.readFileSync(path.join(syntheticPdfRoot, "baseline.txt"), "utf8"), "baseline");
    assert.equal(fs.readFileSync(path.join(syntheticPdfRoot, "nested", "retained.txt"), "utf8"), "retained");
    assert.equal(fs.existsSync(path.join(syntheticPdfRoot, "unexpected.txt")), false);
    assert.throws(
      () => restorePdfTemp(path.join(sandbox, "outside"), snapshot, expectedParent),
      /unexpected PDF temp path/,
    );

    let failedInvocationRoot = null;
    let observedExitCode = null;
    runTests(
      ["test/test-environment-isolation.test.js"],
      process.env,
      {
        resolveRendererPython: () => process.execPath,
        setExitCode: (code) => {
          observedExitCode = code;
        },
        spawnTestProcess(executable, _arguments, options) {
          failedInvocationRoot = options.env.PANTHEON_TEST_RUNTIME_ROOT;
          fs.mkdirSync(realPdfRoot, { recursive: true });
          fs.writeFileSync(
            path.join(realPdfRoot, "synthetic-wrapper-failure.txt"),
            "must be restored away",
          );
          return spawnSync(executable, ["-e", "process.exit(23)"], {
            ...options,
            encoding: "utf8",
            stdio: "pipe",
          });
        },
      },
    );
    assert.equal(observedExitCode, 23);
    assert.ok(failedInvocationRoot);
    assert.equal(fs.existsSync(path.dirname(failedInvocationRoot)), false);
    assert.deepEqual(directorySnapshot(realPdfRoot), realPdfBefore);

    let restoreFailureRoot = null;
    try {
      assert.throws(
        () => runTests(
          ["test/test-environment-isolation.test.js"],
          process.env,
          {
            resolveRendererPython: () => process.execPath,
            restorePdfTemp: (target) => {
              fs.rmSync(target, { recursive: true, force: true });
              fs.mkdirSync(target, { recursive: true });
              fs.writeFileSync(
                path.join(target, "partial-restore-corruption.txt"),
                "synthetic partial restore",
              );
              throw new Error("synthetic PDF restore failure after target mutation");
            },
            spawnTestProcess(_executable, _arguments, options) {
              restoreFailureRoot = path.dirname(options.env.PANTHEON_TEST_RUNTIME_ROOT);
              return { status: 0 };
            },
          },
        ),
        /synthetic PDF restore failure after target mutation/,
      );
      assert.ok(restoreFailureRoot);
      assert.equal(fs.existsSync(restoreFailureRoot), true);
      assert.deepEqual(
        directorySnapshot(path.join(restoreFailureRoot, "pre-test-pdfs")),
        realPdfBefore,
      );
      assert.notDeepEqual(directorySnapshot(realPdfRoot), realPdfBefore);
    } finally {
      if (restoreFailureRoot) {
        restorePdfTemp(
          realPdfRoot,
          path.join(restoreFailureRoot, "pre-test-pdfs"),
        );
        fs.rmSync(restoreFailureRoot, { recursive: true, force: true });
      }
    }

    const wrapperRootsAfter = fs.readdirSync(os.tmpdir())
      .filter((name) => name.startsWith(runtimePrefix));
    assert.deepEqual(
      wrapperRootsAfter.filter((name) => !wrapperRootsBefore.has(name)),
      [],
    );
    assert.deepEqual(directorySnapshot(realPdfRoot), realPdfBefore);
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});
