#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const EXPECTED_VERSION = "2.1.1";
const P0_DEPENDENCIES = Object.freeze({
  "P0-W01": [],
  "P0-W02": ["P0-W01"],
  "P0-W03": ["P0-W02"],
  "P0-W04": ["P0-W03"],
  "P0-W04A": ["P0-W04"],
  "P0-W04B": ["P0-W04A"],
  "P0-W05": ["P0-W01", "P0-W02", "P0-W03", "P0-W04", "P0-W04A", "P0-W04B"],
});

function runGit(cwd, args) {
  const result = spawnSync(
    "git",
    ["--no-optional-locks", ...args],
    {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0) throw new Error("git_failed");
  return (result.stdout || "").trim();
}

function readRequired(root, relativePath) {
  try {
    return fs.readFileSync(path.join(root, relativePath), "utf8");
  } catch {
    throw new Error(`missing:${relativePath}`);
  }
}

function readProgress(root) {
  const relativePath = "docs/v2/PROGRESS.json";
  const source = readRequired(root, relativePath);
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`invalid_json:${relativePath}`);
  }
}

function markdownField(markdown, label) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markdown.match(new RegExp(`^\\*\\*${escaped}:\\*\\*\\s*(.+?)\\s*$`, "mi"));
  return match ? match[1].trim() : null;
}

function exactNextAction(markdown) {
  const heading = /^## Exact next action\s*$/gmi.exec(markdown);
  if (heading) {
    const remainder = markdown.slice(heading.index + heading[0].length).replace(/^\r?\n/, "");
    const nextHeading = remainder.search(/^##\s+/m);
    return (nextHeading === -1 ? remainder : remainder.slice(0, nextHeading)).trim();
  }
  const fallback = markdown.match(/^- exact next action:\s*(.+?)\s*$/mi);
  return fallback ? fallback[1].trim() : "";
}

function parseBlockers(markdown) {
  const headings = [...markdown.matchAll(/^##\s+([A-Z]\d+-B\d+)\s+(?:—|-)\s+(.+?)\s*$/gm)];
  return headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? markdown.length;
    const section = markdown.slice(start, end);
    const status = section.match(/^- \*\*Status:\*\*\s*(.+?)\s*$/mi);
    return {
      id: heading[1],
      title: heading[2].trim(),
      status: status ? status[1].trim() : "status not recorded",
    };
  });
}

function redact(value) {
  return String(value)
    .replace(
      /["'`]([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL)[A-Z0-9_]*)["'`]\s*[:=]\s*["'`][^"'`\r\n]+["'`]/gi,
      "$1=[REDACTED]",
    )
    .replace(
      /\b([A-Z0-9_]*(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIAL)[A-Z0-9_]*)\s*[:=]\s*[^\s,;`]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/(\bAuthorization\s*:\s*Bearer)\s+[^\s,;]+/gi, "$1 [REDACTED]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|xox[a-z]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]")
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[REDACTED]@")
    .replace(/\s+/g, " ")
    .trim();
}

function plain(value) {
  return value === null || value === undefined ? "none" : redact(value);
}

function normalizedPath(value) {
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function handoffAgentId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "codex") return "codex";
  if (normalized === "claude" || normalized === "claude code") return "claude";
  if (normalized === "none") return null;
  return normalized;
}

function handoffLocation(value) {
  const clean = String(value || "").trim();
  const quoted = clean.match(/^`([^`]+)`\s+\/\s+`([^`]+)`$/);
  if (quoted) return { worktree: quoted[1], branch: quoted[2] };
  const separator = clean.lastIndexOf(" / ");
  if (separator === -1) return null;
  return {
    worktree: clean.slice(0, separator).trim(),
    branch: clean.slice(separator + 3).trim(),
  };
}

function completionPath(packageId) {
  return `docs/v2/evidence/packages/${packageId}/COMPLETION.md`;
}

function hasEvidence(workPackage, expectedPath) {
  return Array.isArray(workPackage?.evidence)
    && workPackage.evidence.some((entry) => String(entry).replace(/\\/g, "/") === expectedPath);
}

function checkState(state) {
  const { root, branch, progress, blockers, handoff } = state;
  const issues = [];
  if (progress.masterPlanVersion !== EXPECTED_VERSION) {
    issues.push(`PROGRESS.masterPlanVersion must be ${EXPECTED_VERSION}.`);
  }

  const phases = Array.isArray(progress.phases) ? progress.phases : [];
  const phaseMatches = phases.filter((phase) => phase?.id === progress.currentPhase);
  if (phaseMatches.length !== 1) {
    issues.push("PROGRESS.currentPhase must identify exactly one phase.");
  }
  const phase = phaseMatches[0] || null;
  const workPackages = Array.isArray(phase?.workPackages) ? phase.workPackages : [];
  const currentMatches = progress.currentWorkPackage === null
    ? []
    : workPackages.filter((workPackage) => workPackage?.id === progress.currentWorkPackage);
  if (progress.currentWorkPackage !== null && currentMatches.length !== 1) {
    issues.push("PROGRESS.currentWorkPackage must identify exactly one package in the current phase.");
  }
  const currentPackage = currentMatches[0] || null;
  const readyPackages = workPackages.filter((workPackage) => workPackage?.status === "ready");
  if (!currentPackage && readyPackages.length > 1) {
    issues.push("The current phase has more than one ready package.");
  }
  const focusedPackage = currentPackage || readyPackages[0] || null;

  const handoffPackage = markdownField(handoff, "Package");
  const handoffStatus = markdownField(handoff, "Status");
  const handoffAgent = markdownField(handoff, "Current writing agent");
  const handoffWorktree = markdownField(handoff, "Worktree/branch");
  const handoffRootAndBranch = handoffLocation(handoffWorktree);
  const nextAction = exactNextAction(handoff);
  if (!handoffPackage || !handoffStatus || !handoffAgent || !handoffWorktree) {
    issues.push("ACTIVE_HANDOFF metadata is incomplete.");
  }
  if (!nextAction) issues.push("ACTIVE_HANDOFF must record an exact next action.");

  if (currentPackage) {
    if (String(handoffPackage).toLowerCase() !== currentPackage.id.toLowerCase()) {
      issues.push("ACTIVE_HANDOFF package does not match PROGRESS.currentWorkPackage.");
    }
    if (String(handoffStatus).toLowerCase() !== String(currentPackage.status).toLowerCase()) {
      issues.push("ACTIVE_HANDOFF status does not match the current package status.");
    }
    if (!progress.activeAgent || !progress.activeWorktree) {
      issues.push("An active package requires PROGRESS activeAgent and activeWorktree.");
    }
    if (handoffAgentId(handoffAgent) !== progress.activeAgent) {
      issues.push("ACTIVE_HANDOFF writer does not match PROGRESS.activeAgent.");
    }
    if (progress.activeWorktree && normalizedPath(progress.activeWorktree) !== normalizedPath(root)) {
      issues.push("PROGRESS.activeWorktree does not match the active Git root.");
    }
    if (
      progress.activeWorktree
      && (!handoffRootAndBranch
        || normalizedPath(handoffRootAndBranch.worktree) !== normalizedPath(progress.activeWorktree))
    ) {
      issues.push("ACTIVE_HANDOFF worktree does not match PROGRESS.activeWorktree.");
    }
    if (!branch || !handoffRootAndBranch || handoffRootAndBranch.branch !== branch) {
      issues.push("ACTIVE_HANDOFF branch does not match the active Git branch.");
    }
    const allowedOutcomes = currentPackage.status === "in_progress"
      ? ["in_progress", "handoff_ready"]
      : [currentPackage.status];
    if (!allowedOutcomes.includes(progress.sessionOutcome)) {
      issues.push("PROGRESS.sessionOutcome does not match the active package state.");
    }
  } else {
    if (String(handoffPackage).toLowerCase() !== "none" || handoffStatus !== "no_active_package") {
      issues.push("ACTIVE_HANDOFF must be closed when PROGRESS has no current package.");
    }
    if (progress.activeAgent !== null || progress.activeWorktree !== null) {
      issues.push("PROGRESS activeAgent and activeWorktree must be null with no current package.");
    }
    if (handoffAgentId(handoffAgent) !== null || String(handoffWorktree).toLowerCase() !== "none") {
      issues.push("ACTIVE_HANDOFF writer and worktree must be none when closed.");
    }
    if (!["complete", "not_started"].includes(progress.sessionOutcome)) {
      issues.push("PROGRESS.sessionOutcome must be complete or not_started with no current package.");
    }
  }

  const completionIssueStart = issues.length;
  for (const workPackage of workPackages) {
    const expected = completionPath(workPackage.id);
    const exists = fs.existsSync(path.join(root, expected));
    if (workPackage.status === "complete" && (!exists || !hasEvidence(workPackage, expected))) {
      issues.push(`${workPackage.id} is complete without its listed completion record.`);
    }
    if (workPackage.status !== "complete" && exists) {
      issues.push(`${workPackage.id} has a completion record but is not marked complete.`);
    }
  }

  const dependencyIds = focusedPackage ? (P0_DEPENDENCIES[focusedPackage.id] || []) : [];
  for (const workPackage of workPackages.filter((entry) => entry.status !== "backlog")) {
    for (const dependencyId of P0_DEPENDENCIES[workPackage.id] || []) {
      const dependency = workPackages.find((entry) => entry?.id === dependencyId);
      const expected = completionPath(dependencyId);
      if (
        dependency?.status !== "complete"
        || !fs.existsSync(path.join(root, expected))
        || !hasEvidence(dependency, expected)
      ) {
        issues.push(`${workPackage.id} dependency ${dependencyId} is not complete with evidence.`);
      }
    }
  }
  const completionConsistent = issues.length === completionIssueStart;

  const blockerIds = new Set(blockers.map((blocker) => blocker.id));
  for (const blockerId of focusedPackage?.blockers || []) {
    if (!blockerIds.has(blockerId)) {
      issues.push(`${focusedPackage.id} references blocker ${blockerId} missing from BLOCKERS.md.`);
    }
  }
  if (focusedPackage && !fs.existsSync(path.join(root, "docs/v2/work-packages", `${focusedPackage.id}.md`))) {
    issues.push(`${focusedPackage.id} is missing its Work Package record.`);
  }

  return {
    issues,
    phase,
    currentPackage,
    focusedPackage,
    dependencyIds,
    completionConsistent,
    nextAction,
  };
}

function printStatus(state, checked) {
  const outcome = checkState(state);
  const completed = (outcome.phase?.workPackages || [])
    .filter((workPackage) => workPackage.status === "complete")
    .map((workPackage) => workPackage.id);
  const handoffSummary = [
    `package=${plain(markdownField(state.handoff, "Package"))}`,
    `status=${plain(markdownField(state.handoff, "Status"))}`,
    `writer=${plain(markdownField(state.handoff, "Current writing agent"))}`,
    `worktree/branch=${plain(markdownField(state.handoff, "Worktree/branch"))}`,
  ].join("; ");

  process.stdout.write(`Pantheon v${EXPECTED_VERSION} repository status\n`);
  process.stdout.write(`Repository root: ${plain(state.root)}\n`);
  process.stdout.write(`Branch: ${plain(state.branch || "detached HEAD")}\n`);
  process.stdout.write(`HEAD: ${plain(state.head)}\n`);
  process.stdout.write(`Working tree: ${state.dirtyCount ? `dirty (${state.dirtyCount} path${state.dirtyCount === 1 ? "" : "s"})` : "clean"}\n`);
  process.stdout.write(`Current phase: ${plain(outcome.phase?.id)} (${plain(outcome.phase?.status)})\n`);
  process.stdout.write(`Current work package: ${outcome.currentPackage ? `${plain(outcome.currentPackage.id)} (${plain(outcome.currentPackage.status)})` : "none"}\n`);
  if (!outcome.currentPackage && outcome.focusedPackage) {
    process.stdout.write(`Next ready package: ${plain(outcome.focusedPackage.id)} (${plain(outcome.focusedPackage.status)})\n`);
  }
  process.stdout.write(`Active agent: ${plain(state.progress.activeAgent)}\n`);
  process.stdout.write(`Active worktree: ${plain(state.progress.activeWorktree)}\n`);
  if (state.blockers.length) {
    process.stdout.write("Blockers:\n");
    for (const blocker of state.blockers) {
      process.stdout.write(`- ${plain(blocker.id)} — ${plain(blocker.title)} [${plain(blocker.status)}]\n`);
    }
  } else {
    process.stdout.write("Blockers: none\n");
  }
  process.stdout.write(`ACTIVE_HANDOFF: ${handoffSummary}\n`);
  process.stdout.write(`Dependencies: ${outcome.dependencyIds.length ? outcome.dependencyIds.join(", ") : "none"}\n`);
  process.stdout.write(`Completed packages: ${completed.length ? completed.join(", ") : "none"}\n`);
  process.stdout.write(`Dependency/completion consistency: ${outcome.completionConsistent ? "PASS" : "FAIL"}\n`);
  process.stdout.write(`Exact next action: ${plain(outcome.nextAction)}\n`);
  process.stdout.write(`Consistency: ${outcome.issues.length ? "FAIL" : "PASS"}\n`);
  for (const issue of outcome.issues) process.stdout.write(`- ${redact(issue)}\n`);

  if (checked && outcome.issues.length) process.exitCode = 1;
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--check") || args.filter((arg) => arg === "--check").length > 1) {
    process.stderr.write("Usage: node scripts/v2/status.js [--check]\n");
    process.exitCode = 2;
    return;
  }

  let root;
  try {
    root = runGit(process.cwd(), ["rev-parse", "--show-toplevel"]);
  } catch {
    process.stderr.write("Pantheon status requires invocation inside a Git repository.\n");
    process.exitCode = 2;
    return;
  }

  try {
    const progress = readProgress(root);
    const blockerText = readRequired(root, "docs/v2/BLOCKERS.md");
    const handoff = readRequired(root, "docs/v2/ACTIVE_HANDOFF.md");
    const dirtyOutput = runGit(root, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]);
    printStatus(
      {
        root,
        branch: runGit(root, ["branch", "--show-current"]),
        head: runGit(root, ["rev-parse", "HEAD"]),
        dirtyCount: dirtyOutput ? dirtyOutput.split("\0").filter(Boolean).length : 0,
        progress,
        blockers: parseBlockers(blockerText),
        handoff,
      },
      args.includes("--check"),
    );
  } catch (error) {
    const message = String(error.message || "");
    if (message.startsWith("missing:")) {
      process.stderr.write(`Pantheon status cannot read required repository file ${message.slice(8)}.\n`);
    } else if (message.startsWith("invalid_json:")) {
      process.stderr.write(`Pantheon status found invalid JSON in ${message.slice(13)}.\n`);
    } else {
      process.stderr.write("Pantheon status could not read the repository state.\n");
    }
    process.exitCode = 2;
  }
}

main();
