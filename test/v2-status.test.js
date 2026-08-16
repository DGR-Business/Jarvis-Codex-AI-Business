"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const statusScript = path.resolve(__dirname, "..", "scripts", "v2", "status.js");
const fixtureBranch = "codex/p0-engineering-os";

function runGit(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`,
  );
  return (result.stdout || "").trim();
}

function writeFile(root, relativePath, contents) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}

function workPackage(id, status, evidence = []) {
  return {
    id,
    title: `${id} fixture`,
    status,
    preferredAgent: "codex",
    handoffAllowed: true,
    evidence,
    blockers: [],
    commits: [],
  };
}

function createFixture(options = {}) {
  const closed = options.closed === true;
  const secretStatus = options.secretStatus === true;
  const activeAgent = options.agent || "codex";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-v2-status-"));
  const completion = (id) => `docs/v2/evidence/packages/${id}/COMPLETION.md`;
  const completedEvidence = (id) => [completion(id)];
  const progress = {
    masterPlanVersion: options.version || "2.1.1",
    currentPhase: "P0",
    currentWorkPackage: closed ? null : "P0-W03",
    activeAgent: closed ? null : activeAgent,
    activeWorktree: closed ? null : root,
    sessionOutcome: closed ? "complete" : "in_progress",
    updatedAt: "2026-08-15T00:00:00+10:00",
    phases: [
      {
        id: "P0",
        name: "V2.1.1 engineering operating system",
        status: "in_progress",
        executionPack: "docs/v2/phases/P0-EXECUTION-PACK.md",
        workPackages: [
          workPackage("P0-W01", "complete", completedEvidence("P0-W01")),
          workPackage("P0-W02", "complete", completedEvidence("P0-W02")),
          workPackage(
            "P0-W03",
            closed ? "complete" : "in_progress",
            closed ? completedEvidence("P0-W03") : [],
          ),
          workPackage("P0-W04", closed ? "ready" : "backlog"),
          workPackage("P0-W04A", "backlog"),
          workPackage("P0-W05", "backlog"),
        ],
      },
    ],
  };
  writeFile(root, "docs/v2/PROGRESS.json", `${JSON.stringify(progress, null, 2)}\n`);
  writeFile(
    root,
    "docs/v2/BLOCKERS.md",
    [
      "# Pantheon v2.1.1 Blockers",
      "",
      "## P0-B01 — Ordinary proof-ledger isolation is not yet green",
      "",
      secretStatus
        ? "- **Status:** active; TOKEN=synthetic-status-secret-value"
        : "- **Status:** active Phase 0 limitation; nonblocking for P0-W03.",
      "- **Owner:** P0-W04.",
      "",
    ].join("\n"),
  );
  const nextAction = secretStatus
    ? "Continue with OPENAI_API_KEY=synthetic-status-secret-value, \"apiKey\": \"synthetic-json-secret\", Authorization: Bearer synthetic-bearer-secret, and https://fixture-user:fixture-password@example.invalid."
    : closed
      ? "Start a fresh P0-W04 implementation session and do not begin P0-W05."
      : "Finish only the P0-W03 status helper and its focused verification.";
  writeFile(
    root,
    "docs/v2/ACTIVE_HANDOFF.md",
    closed
      ? [
        "# Active Handoff",
        "",
        "**Package:** none",
        "**Status:** no_active_package",
        "**Current writing agent:** none",
        "**Worktree/branch:** none",
        "",
        "## Exact next action",
        "",
        nextAction,
        "",
      ].join("\n")
      : [
        "# Active Handoff",
        "",
        "**Package:** P0-W03",
        "**Status:** in_progress",
        `**Current writing agent:** ${activeAgent === "claude" ? "Claude Code" : "Codex"}`,
        `**Worktree/branch:** \`${root}\` / \`${fixtureBranch}\``,
        "",
        "## Exact next action",
        "",
        nextAction,
        "",
      ].join("\n"),
  );

  for (const id of ["P0-W01", "P0-W02", "P0-W03", "P0-W04", "P0-W04A", "P0-W05"]) {
    writeFile(root, `docs/v2/work-packages/${id}.md`, `# ${id} fixture\n`);
  }
  for (const id of closed ? ["P0-W01", "P0-W02", "P0-W03"] : ["P0-W01", "P0-W02"]) {
    writeFile(root, completion(id), `# ${id} Completion Report\n\n**Status:** complete\n`);
  }
  writeFile(root, "README.md", "Pantheon status fixture.\n");

  runGit(root, ["init", "--quiet", "--initial-branch", fixtureBranch]);
  runGit(root, ["add", "."]);
  runGit(root, [
    "-c",
    "user.name=Pantheon Test",
    "-c",
    "user.email=pantheon-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "status fixture",
  ]);
  return root;
}

function runStatus(cwd, args = ["--check"], environment = {}) {
  return spawnSync(process.execPath, [statusScript, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    timeout: 10_000,
    windowsHide: true,
  });
}

function outputOf(result) {
  return `${result.stdout || ""}${result.stderr || ""}`;
}

function removeFixture(root) {
  const relative = path.relative(os.tmpdir(), root);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}

function repositorySnapshot(root) {
  const files = {};
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else {
        const relative = path.relative(root, absolute).replace(/\\/g, "/");
        files[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      }
    }
  }
  visit(root);
  return {
    files,
    branch: runGit(root, ["branch", "--show-current"]),
    head: runGit(root, ["rev-parse", "HEAD"]),
    status: runGit(root, ["--no-optional-locks", "status", "--porcelain=v1", "--untracked-files=all"]),
  };
}

test("reports a valid closed P0-W03 state from a nested repository directory", (t) => {
  const root = createFixture({ closed: true });
  t.after(() => removeFixture(root));

  const result = runStatus(path.join(root, "docs", "v2"));
  const output = outputOf(result);
  assert.equal(result.status, 0, output);
  assert.ok(output.includes(`Repository root: ${root.replace(/\\/g, "/")}`));
  assert.match(output, /Branch: codex\/p0-engineering-os/);
  assert.match(output, /HEAD: [0-9a-f]{40}/);
  assert.match(output, /Working tree: clean/);
  assert.match(output, /Current phase: P0 \(in_progress\)/);
  assert.match(output, /Current work package: none/);
  assert.match(output, /Next ready package: P0-W04 \(ready\)/);
  assert.match(output, /Active agent: none/);
  assert.match(output, /Active worktree: none/);
  assert.match(output, /Blockers:\s+- P0-B01/);
  assert.match(output, /ACTIVE_HANDOFF: package=none; status=no_active_package/);
  assert.match(output, /Dependencies: P0-W03/);
  assert.match(output, /Completed packages: P0-W01, P0-W02, P0-W03/);
  assert.match(output, /Dependency\/completion consistency: PASS/);
  assert.match(output, /Exact next action: Start a fresh P0-W04 implementation session/);
  assert.match(output, /Consistency: PASS/);

  const progressPath = path.join(root, "docs", "v2", "PROGRESS.json");
  const originalProgress = fs.readFileSync(progressPath, "utf8");
  const staleOutcome = JSON.parse(originalProgress);
  staleOutcome.sessionOutcome = "in_progress";
  fs.writeFileSync(progressPath, `${JSON.stringify(staleOutcome, null, 2)}\n`);
  const staleResult = runStatus(root);
  assert.equal(staleResult.status, 1, outputOf(staleResult));
  assert.match(outputOf(staleResult), /sessionOutcome must be complete or not_started/);

  const brokenDependency = JSON.parse(originalProgress);
  const p0 = brokenDependency.phases.find((phase) => phase.id === "P0");
  const w02 = p0.workPackages.find((workPackageEntry) => workPackageEntry.id === "P0-W02");
  w02.status = "backlog";
  w02.evidence = [];
  fs.writeFileSync(progressPath, `${JSON.stringify(brokenDependency, null, 2)}\n`);
  fs.rmSync(path.join(root, "docs", "v2", "evidence", "packages", "P0-W02", "COMPLETION.md"));
  const dependencyResult = runStatus(root);
  assert.equal(dependencyResult.status, 1, outputOf(dependencyResult));
  assert.match(outputOf(dependencyResult), /P0-W03 dependency P0-W02 is not complete with evidence/);
});

test("fails when PROGRESS and ACTIVE_HANDOFF identify different packages", (t) => {
  const root = createFixture();
  t.after(() => removeFixture(root));
  const handoffPath = path.join(root, "docs", "v2", "ACTIVE_HANDOFF.md");
  const handoff = fs.readFileSync(handoffPath, "utf8");
  fs.writeFileSync(handoffPath, handoff.replace("**Package:** P0-W03", "**Package:** P0-W04"));

  const result = runStatus(root);
  const output = outputOf(result);
  assert.equal(result.status, 1, output);
  assert.match(output, /ACTIVE_HANDOFF package does not match PROGRESS\.currentWorkPackage/);
  assert.match(output, /Consistency: FAIL/);

  fs.writeFileSync(handoffPath, handoff.replace(root, `${root}-different`));
  const worktreeResult = runStatus(root);
  assert.equal(worktreeResult.status, 1, outputOf(worktreeResult));
  assert.match(outputOf(worktreeResult), /ACTIVE_HANDOFF worktree does not match/);
});

test("enforces the W04 to W04A to W05 completion-evidence dependency chain", (t) => {
  const root = createFixture({ closed: true });
  t.after(() => removeFixture(root));
  const progressPath = path.join(root, "docs", "v2", "PROGRESS.json");
  const completion = (id) => `docs/v2/evidence/packages/${id}/COMPLETION.md`;
  const writeCompletion = (id) => writeFile(
    root,
    completion(id),
    `# ${id} Completion Report\n\n**Status:** complete\n`,
  );
  const readProgress = () => JSON.parse(fs.readFileSync(progressPath, "utf8"));
  const writeProgress = (progress) => fs.writeFileSync(
    progressPath,
    `${JSON.stringify(progress, null, 2)}\n`,
  );
  const packageById = (progress, id) => progress.phases[0].workPackages.find(
    (entry) => entry.id === id,
  );

  const w04aReady = readProgress();
  packageById(w04aReady, "P0-W04").status = "complete";
  packageById(w04aReady, "P0-W04").evidence = [completion("P0-W04")];
  packageById(w04aReady, "P0-W04A").status = "ready";
  writeCompletion("P0-W04");
  writeProgress(w04aReady);
  const readyResult = runStatus(root);
  assert.equal(readyResult.status, 0, outputOf(readyResult));
  assert.match(outputOf(readyResult), /Next ready package: P0-W04A \(ready\)/);
  assert.match(outputOf(readyResult), /Dependencies: P0-W04/);

  const missingW04 = structuredClone(w04aReady);
  packageById(missingW04, "P0-W04").status = "backlog";
  packageById(missingW04, "P0-W04").evidence = [];
  fs.rmSync(path.join(root, completion("P0-W04")));
  writeProgress(missingW04);
  const missingW04Result = runStatus(root);
  assert.equal(missingW04Result.status, 1, outputOf(missingW04Result));
  assert.match(
    outputOf(missingW04Result),
    /P0-W04A dependency P0-W04 is not complete with evidence/,
  );

  const w05Ready = structuredClone(w04aReady);
  packageById(w05Ready, "P0-W04A").status = "complete";
  packageById(w05Ready, "P0-W04A").evidence = [completion("P0-W04A")];
  packageById(w05Ready, "P0-W05").status = "ready";
  writeCompletion("P0-W04");
  writeCompletion("P0-W04A");
  writeProgress(w05Ready);
  const w05Result = runStatus(root);
  assert.equal(w05Result.status, 0, outputOf(w05Result));
  assert.match(outputOf(w05Result), /Next ready package: P0-W05 \(ready\)/);
  assert.match(outputOf(w05Result), /Dependencies: P0-W01, P0-W02, P0-W03, P0-W04, P0-W04A/);

  const missingW04a = structuredClone(w05Ready);
  packageById(missingW04a, "P0-W04A").status = "backlog";
  packageById(missingW04a, "P0-W04A").evidence = [];
  fs.rmSync(path.join(root, completion("P0-W04A")));
  writeProgress(missingW04a);
  const missingW04aResult = runStatus(root);
  assert.equal(missingW04aResult.status, 1, outputOf(missingW04aResult));
  assert.match(
    outputOf(missingW04aResult),
    /P0-W05 dependency P0-W04A is not complete with evidence/,
  );
});

test("fails when the programme version is not v2.1.1", (t) => {
  const root = createFixture({ version: "2.1" });
  t.after(() => removeFixture(root));

  const result = runStatus(root);
  const output = outputOf(result);
  assert.equal(result.status, 1, output);
  assert.match(output, /PROGRESS\.masterPlanVersion must be 2\.1\.1/);
  assert.match(output, /Consistency: FAIL/);
});

test("fails safely outside a Git repository", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "pantheon-v2-nonrepo-"));
  t.after(() => removeFixture(directory));

  const result = runStatus(directory);
  const output = outputOf(result);
  assert.equal(result.status, 2, output);
  assert.match(output, /requires invocation inside a Git repository/);
  assert.equal(output.includes(directory), false);
});

test("reports a dirty state without exposing paths or failing consistency", (t) => {
  const root = createFixture();
  t.after(() => removeFixture(root));
  const untrackedName = "sensitive-untracked-fixture-name.txt";
  fs.writeFileSync(path.join(root, untrackedName), "synthetic dirty state\n");

  const result = runStatus(root);
  const output = outputOf(result);
  assert.equal(result.status, 0, output);
  assert.match(output, /Working tree: dirty \(1 path\)/);
  assert.match(output, /Current work package: P0-W03 \(in_progress\)/);
  assert.match(output, /Active agent: codex/);
  assert.ok(output.includes(`Active worktree: ${root}`));
  assert.match(output, /Consistency: PASS/);
  assert.equal(output.includes(untrackedName), false);
  assert.equal(fs.existsSync(path.join(root, untrackedName)), true);
});

test("supports Claude, redacts synthetic secrets, ignores environment values, and writes nothing", (t) => {
  const root = createFixture({ secretStatus: true, agent: "claude" });
  t.after(() => removeFixture(root));
  const environmentSentinel = "environment-sentinel-must-not-appear";
  const before = repositorySnapshot(root);

  const result = runStatus(root, ["--check"], {
    PANTHEON_STATUS_TEST_SENTINEL: environmentSentinel,
  });
  const output = outputOf(result);
  const after = repositorySnapshot(root);

  assert.equal(result.status, 0, output);
  assert.match(output, /Active agent: claude/);
  assert.match(output, /writer=Claude Code/);
  assert.match(output, /Consistency: PASS/);
  assert.match(output, /\[REDACTED\]/);
  assert.equal(output.includes("synthetic-status-secret-value"), false);
  assert.equal(output.includes("synthetic-json-secret"), false);
  assert.equal(output.includes("synthetic-bearer-secret"), false);
  assert.equal(output.includes("fixture-password"), false);
  assert.equal(output.includes(environmentSentinel), false);
  assert.deepEqual(after, before);
});
