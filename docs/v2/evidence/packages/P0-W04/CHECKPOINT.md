# P0-W04 Blocked Checkpoint Report

**Package:** P0-W04 — Harden tests and rehearse fresh-session continuity
**Status:** blocked — acceptance criterion 4 is incomplete; this is not a
package-completion claim, so `COMPLETION.md` is intentionally absent
**Checkpointed by:** Codex
**Checkpointed:** 2026-08-15T23:05:07+10:00 (Australia/Brisbane)
**Branch/worktree:** `codex/p0-engineering-os` /
`C:\Pantheon-worktrees\P0-engineering-os`
**Checkpoint predecessor:**
`9c29d19b140c648f8100605b6479f790320be695`
**Baseline B:** `718e50670812ad5da7210bd9f183521328cccf93`
**Preserved unverified WIP:**
`612a35c8b1d881f638570373d06f99d26bfb280e`

The coherent blocked-checkpoint commit is the commit containing this report.
Its own SHA is intentionally not self-recorded; normal Git history supplies it.
P0-W04 remains blocked and P0-W05 remains backlog.

## Governing authority

- Owner-approved Phase 0 Execution Pack, approved identifier `0.2-draft`,
  especially sections 3, 8, 12 and 20.
- Approved verbatim execution copy: `docs/v2/work-packages/P0-W04.md`.
- `docs/v2/decisions/ADR-0001-P0-EXECUTION-CONTRACT.md` for one writer, normal
  Git/state continuity, honest Claude status, optional evidence-based hooks and
  no P0 browser work.
- Completed dependency chain: P0-W01, P0-W02 and P0-W03, with P0-W03 completed
  at predecessor `9c29d19b140c648f8100605b6479f790320be695`.

The initiating owner instruction for this W04 session also expressly required
one concise permanent `NEXT SESSION — COPY/PASTE PROMPT` rule in the smallest
shared instruction surface and required the actual final prompt to follow the
repository's true terminal state. This is direct owner authority for an
additive continuity instruction. It changes no Pack objective, product scope,
provider authority, dependency contract or package readiness rule, so no Phase
Pack amendment or new subsystem was created.

## Objective result

The ordinary wrapper no longer inherits an ambient environment and tries to
remove known-dangerous names. It now constructs a deliberate child environment
per invocation, roots configurable writes under that invocation, retains only
required OS/tool inputs, and preserves the production proof ledger's
DB-relative isolation semantics. Focused checks prove the original P0-B01
journey regression and adjacent wrapper/runtime behavior are green.

The package is not complete. The only provisioned renderer still contains
Pillow 12.3.0 while `requirements-runtime.txt` requires exactly 12.2.0. The
production renderer check fails that precondition, and W04 does not authorize a
tool installation or dependency-pin change. P0-B02 therefore prevents the one
required green final-code ordinary suite.

## Name-only and synthetic-sentinel findings

No owner value was read or printed. The audit examined names and synthetic
sentinels only. It covered:

- current and legacy privacy-key and proof-path aliases;
- provider credentials, backup passphrases, control/bootstrap/instance inputs;
- live model, research, image and lifecycle controls;
- Node/Python injection and TLS/proxy/tool-path inputs; and
- database, artifact, approval, backup, private-operator, credentials,
  launcher, runtime-metadata, assurance, profile, cache and temp write paths.

The demonstrated defect was broad inheritance combined with one reused proof
alias. Earlier tests could create keyed proof state, and a later test correctly
failed closed after changing its synthetic privacy key against that shared
ledger. A fixed proof file per shard would still have been unsafe.

## Implemented isolation contract

- Parent inputs are selected case-insensitively from a small OS allowlist; raw
  PATH, Node/Python injection variables, provider credentials and arbitrary
  application controls are not copied.
- PATH is rebuilt from canonical existing Node, Windows system, PowerShell, Git
  and validated renderer directories. Duplicate case aliases and hostile first
  PATH entries cannot select child tools.
- Each invocation receives its own data, DB, artifact, approval, backup,
  credential, launcher, private-operator, runtime-metadata, assurance, profile,
  npm cache and OS temp paths.
- Both proof-path aliases are deliberately absent. The existing production
  resolver therefore creates a distinct `proof-exposure.sqlite` beside each
  actual runtime DB; focused proof resolves two distinct paths inside the
  disposable invocation root.
- Ambient live enable flags are absent and credentials are excluded. The
  established dry-run value remains fixed, while tests can still enable their
  own local stubs after startup. Scheduler behavior retains its deterministic
  production default.
- Local and ordinary CI requests cannot enter the lifecycle test. Hosted
  lifecycle mode requires the exact quarantined target plus the bounded GitHub
  Windows job identity and retains concurrency 1 and the nine-minute deadline.
- Test-path grammar and lifecycle quarantine are validated before any renderer
  probe. A renderer override requires a coherent absolute current/legacy pair;
  raw PATH Python candidates are ignored, candidates are canonicalized and
  probes use disposable profile/temp roots.
- Local five-way weighted sharding, ordinary CI sharding, focused singular
  execution, 4/12/9-minute deadlines, `--test-isolation=none`, fail-fast
  behavior, bounded cleanup and PDF snapshot/restore remain intact.
- Repository `tmp/pdfs` remains the only explicit repository-write exception
  and is restored identically after success and failure.

## Acceptance criteria

1. [x] The bounded name-only/synthetic-sentinel audit covers the demonstrated
   and materially adjacent inputs without owner values or a general schema.
2. [x] The wrapper uses a deliberate minimal child environment and proves all
   resolved configurable writes are disposable, with only restored
   `tmp/pdfs` excepted.
3. [x] Focused regressions cover secret/control/tool exclusion, disposable
   paths, proof fallback, local/lifecycle quarantine, sharding, deadlines,
   grammar, cleanup and PDF restoration. Additional runtime checks caught and
   repaired scheduler and test-local live-stub compatibility regressions.
4. [ ] Targeted checks and lint pass, but no final-code complete ordinary suite
   is green. P0-B02 is a D-class renderer environment/tool precondition.
5. [x] A no-history fresh Codex task reconstructed the exact repository state
   from repository evidence and made no changes; its result is recorded below.
6. [x] Claude compatibility remains prepared. The CLI is not provisioned, so
   the honest status is `prepared_not_verified`; no simulated rehearsal.
7. [x] Official repository-hook support was reviewed on 2026-08-15 and the
   documented decision is no hook.
8. [x] No browser/T3/Playwright, lifecycle run, global/user configuration, tool
   installation, credential grant, provider call, spend, production/UI change,
   push, PR, merge, P0-W05 or P1 work occurred.

## Files changed

- Shared completion behavior: `AGENTS.md`.
- Wrapper implementation: `scripts/run-tests.js`.
- Focused regressions: `test/test-environment-isolation.test.js`.
- Normal state: `docs/v2/PROGRESS.json`, `docs/v2/BLOCKERS.md` and
  `docs/v2/ACTIVE_HANDOFF.md`.
- Evidence: this report.

No path under `src/`, `public/`, runtime schema/database, UI, provider adapter,
commercial truth, package/lock/dependency requirements, workflow, Master,
approved Pack, Work Package or ADR changed. No repository hook was installed.
The package specification's `COMPLETION.md` evidence marker is deferred until
all acceptance criteria pass; creating it while blocked would make the bounded
status consistency check fail and would falsely declare package completion.

## Verification and evidence

| Check | Result | Evidence |
|---|---|---|
| JavaScript syntax | PASS | `node --check` on wrapper and focused test |
| `npm.cmd test -- test/test-environment-isolation.test.js` | PASS | 5/5, 0 fail/skip/cancel |
| journey + wrapper regressions | PASS | 11/11, including original proof-ledger regression and sharding/quarantine |
| `npm.cmd test -- test/runtime.test.js` | PASS | final candidate 83/83 after repairing scheduler/live-stub compatibility |
| product/full-journey focused files | PASS | 2/2 |
| `npm.cmd test -- test/v2-status.test.js` | PASS | 6/6; rebuilt PATH retains required Git behavior |
| `npm.cmd run lint` | PASS | exit 0; zero warnings |
| production `checkRenderer()` | BLOCKED (D) | fail; one exact package mismatch, Pillow 12.3.0 versus 12.2.0 |
| complete `npm.cmd test` | BLOCKED (D) | required attempt described below; no green final-code claim |
| fresh Codex reconstruction | PASS | no-history read-only task; concise result below |
| Claude reconstruction/handoff | `prepared_not_verified` | CLI not discoverable; no session simulated |
| final status/diff checks | PASS | consistency PASS; no whitespace finding |

### Complete ordinary-suite attempt

The one required `npm.cmd test` attempt was made before the final review fixes.
Shard 1 passed 19/19. Shard 2 passed 160/162; the two observed failures were the
doctor's exact renderer-package-pin test and the transitive operations-ready
doctor CLI test. Fail-fast left shards 3 through 5 unrun.

That run is evidence of P0-B02, not final-code regression proof. Review then
found scheduler, PATH, lifecycle, renderer-probe-order and launcher-path gaps in
the not-yet-reached code. They were repaired and the affected focused files are
green as recorded above. The final candidate was not put through another full
run because the same production `checkRenderer()` precondition still fails and
W04 lacks authority to provision or change it. There is no full-suite green
claim and no claim about unrun shards.

Only isolated loopback/local-child traffic used by repository tests occurred.
No provider or external network action occurred.

## Fresh Codex reconstruction result

A separate Codex task was created with no conversation history and only the
worktree path plus read-only reconstruction duties. It independently reported:

- root `C:/Pantheon-worktrees/P0-engineering-os`, branch
  `codex/p0-engineering-os` and predecessor HEAD `9c29d19...`;
- exactly five modified paths and one untracked focused test at its snapshot,
  with no staged changes;
- P0-W01 through P0-W03 complete and dependency/completion consistency PASS;
- P0-W04 blocked, targeted isolation green, full-suite acceptance incomplete,
  Claude `prepared_not_verified`, P0-B01 awaiting closure and P0-B02 active;
- P0-W05 not ready; exact next action is a truthful W04 checkpoint followed by
  owner authority for an exact renderer, not later-package work; and
- no repository change by the rehearsal.

It also detected missing reverse blocker links, missing hook-source evidence and
the need to record the direct owner authority for the additive prompt rule.
Those evidence gaps were corrected before this checkpoint. This is the intended
value of the rehearsal rather than a reason to conceal its findings.

A second separate no-history read-only task then reconstructed the seven-path
final checkpoint candidate. It confirmed the exact root/branch/predecessor,
P0-W01 through P0-W03, criteria 1-3 and 5-8 complete, criterion 4 incomplete,
both blocker links, official hook sources/no-hook decision, owner-directed
prompt authority, Claude `prepared_not_verified`, and P0-W05 not ready. It
correctly distinguished this `CHECKPOINT.md` from the intentionally absent
completion marker and made no changes. Its only pre-commit observation was that
the candidate still required the coherent checkpoint commit; the commit
containing this report resolves that expected transient state.

## Claude compatibility

`Get-Command claude -All` found no command. No version command or Claude session
was attempted, no tool was installed, and no global/user configuration was
read or changed. `CLAUDE.md` continues to import `AGENTS.md`; the seven mirrored
`.agents/skills` and `.claude/skills` instruction pairs remain byte-identical.
Archived Claude settings/hooks remain retired. Status:
`prepared_not_verified`.

## Official hook review and decision

Reviewed 2026-08-15:

- OpenAI Codex hooks: <https://learn.chatgpt.com/docs/hooks>
- OpenAI Codex configuration reference:
  <https://learn.chatgpt.com/docs/config-file/config-reference>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Claude Code configuration: <https://code.claude.com/docs/en/configuration>
- Claude Code shared memory/imports: <https://code.claude.com/docs/en/memory>

Codex supports trusted project hook configuration in `.codex/hooks.json` or
`.codex/config.toml`. Claude project hooks belong in
`.claude/settings.json`. Both expose a Stop event, but a Stop text check fires
on ordinary turns and cannot prove final verification, authoritative state,
package readiness or prompt correctness. It would add two config surfaces and
an untestable Claude path without preventing P0-B01. The evidence-based result
is **no hook**. No active or archived hook was created or revived.

## Decisions and deviations

- Used the existing DB-relative production proof resolver instead of changing
  production semantics or imposing one fixed proof file per shard.
- Rebuilt a narrow canonical PATH instead of inheriting ambient PATH or
  converting production code to absolute tool paths.
- Required the exact hosted lifecycle target and GitHub Windows job identity;
  the prohibited lifecycle command was not run locally.
- Accepted an explicitly supplied renderer only as a coherent current/legacy
  absolute pair. An already provisioned exact interpreter can therefore be used
  later without a code change.
- Added the owner-directed prompt rule only to `AGENTS.md`; `CLAUDE.md` inherits
  it. No prompt generator, writer, hook, daemon, database, ledger, state machine
  or orchestration subsystem was added.
- Made no ADR because these choices implement the approved isolation and
  continuity contract without changing product architecture or business intent.

## Interactive browser / E2E / external actions

- Running application, browser, T3, Playwright, screenshots and lifecycle:
  N/A and not run.
- Provider, live runtime, owner data, credential grant, spend and external
  mutation: none.
- Tool/dependency installation and package/renderer pin change: none.
- Push, PR, merge, fetch and remote mutation: none. Remote freshness remains
  unproved.

## Known limitations and blockers

- P0-B01's implementation and exact focused regression are green, but formal
  closure awaits the required complete green ordinary suite.
- P0-B02 is active. Owner action must authorize either one disposable exact
  renderer environment using the repository pins or a separately scoped
  dependency-pin decision. The wrapper requires both `PANTHEON_PYTHON` and
  `JARVIS_PYTHON` to identify the same validated absolute interpreter.
- Claude continuity is `prepared_not_verified` and cannot become verified
  without a real provisioned sequential same-worktree rehearsal.
- Remote freshness and inaccessible external-tool surfaces remain unproved.

## Rollback

Before integration, revert the single blocked-checkpoint commit after review.
That restores the previous wrapper but also reopens the demonstrated P0-B01
environment/proof risk; rollback must not be described as adequate isolation.
Do not delete custody refs, rewrite history, restore archived hooks/settings or
touch global/user configuration.

## Exact next action

Obtain owner authorization for one disposable exact renderer environment using
the existing repository pins, or a separately approved dependency-pin change.
Then continue P0-W04 in this same lane, set both renderer aliases to the same
validated absolute interpreter, rerun the required focused test, lint and one
complete ordinary suite, and close P0-B01/P0-B02 only if all results are green.
Do not begin P0-W05.

## Commits and checkpoint Git status

- P0-W03 completion and checkpoint predecessor:
  `9c29d19b140c648f8100605b6479f790320be695`.
- The P0-W04 blocked-checkpoint commit is the coherent commit containing this
  report and remains discoverable through normal Git history.
- The checkpoint contains only the W04 files listed above; final state checks
  passed immediately before they were committed together.
- Push/PR/merge/remote mutation: none.
