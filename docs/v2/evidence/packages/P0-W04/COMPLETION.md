# P0-W04 Completion Report

**Package:** P0-W04 — Harden tests and rehearse fresh-session continuity
**Status:** complete
**Completed by:** Codex
**Completed:** 2026-08-16T10:49:34+10:00 (Australia/Brisbane)
**Branch/worktree:** `codex/p0-engineering-os` /
`C:\Pantheon-worktrees\P0-engineering-os`
**Initial W04 predecessor:**
`9c29d19b140c648f8100605b6479f790320be695`
**Completion predecessor:**
`1303ce5149c4a5a4ecdb1e93b234b58782f8d16f`
**Baseline B:** `718e50670812ad5da7210bd9f183521328cccf93`
**Preserved unverified WIP:**
`612a35c8b1d881f638570373d06f99d26bfb280e`

The coherent P0-W04 completion commit is the commit containing this report.
Its own SHA is intentionally not self-recorded; normal Git history supplies it
as required by the approved Pack. The historical blocked checkpoint remains
truthful for its time. Owner-approved P0-W04-A01 and the later green audited
candidate supersede it for current state.

## Governing authority

- Owner-approved Phase 0 Execution Pack, approved identifier `0.2-draft`,
  especially sections 3, 8, 12 and 20.
- Approved verbatim execution copy: `docs/v2/work-packages/P0-W04.md`.
- Owner-approved narrow renderer amendment:
  `docs/v2/work-packages/P0-W04-A01-DISPOSABLE-RENDERER-AMENDMENT.md`.
- `docs/v2/decisions/ADR-0001-P0-EXECUTION-CONTRACT.md` for normal Git/state
  continuity, one writer, honest Claude status, optional evidence-based hooks
  and no P0 browser work.
- `docs/v2/decisions/ADR-0002-NEXT-SESSION-PROMPT-CONTRACT.md` for the direct
  owner instruction requiring a repository-derived next-session prompt.
- Completed dependency chain: P0-W01, P0-W02 and P0-W03, with P0-W03 completed
  at the initial W04 predecessor.

P0-W04-A01 is the sole specialization of acceptance criterion 8. It permitted
one external disposable renderer environment, narrowly necessary package-index
access, coherent aliases, verification and cleanup. It did not grant pin,
production, global/user configuration, provider, commercial or later-package
authority.

## Objective and business result

Ordinary tests no longer inherit the ambient process environment and try to
remove only known-dangerous names. The wrapper now creates a deliberate child
environment for each invocation, contains configurable writes, validates tools
and renderer provenance, retains the production proof ledger's DB-relative
fallback, and fails closed around live and lifecycle modes.

The result is engineering-support safety and continuity. It changes no product,
runtime, database, UI, buyer, revenue, provider or commercial semantic. The
complete ordinary inventory passes on the final audited candidate.

## Name-only and synthetic-sentinel findings

No owner secret value was read or printed. The bounded audit characterized:

- current and legacy privacy-key and proof-path aliases;
- provider credentials, backup passphrases, control/bootstrap/instance inputs;
- live model, research, image, scheduler and lifecycle controls;
- Node/Python injection, TLS/proxy and tool-path inputs; and
- database, artifact, approval, backup, private-operator, credentials,
  launcher, runtime-metadata, assurance, profile, cache and temp write paths.

The original defect was broad inheritance plus one shared proof alias. Earlier
tests could create keyed proof state, and a later test correctly failed closed
after changing its synthetic privacy key against that shared ledger. A fixed
proof file per shard would not have resolved the within-process key change.

The final synthetic hostile-PATH fixture contains only its disposable hostile
directory; it does not concatenate or assert the real parent PATH. PDF
success/failure comparisons hash a stable tree representation internally and
expose only `{entries,digest}` to assertion diagnostics, so a mismatch cannot
print pre-existing filenames or bytes.

## Implemented isolation contract

- Non-tool parent inputs are selected case-insensitively from a small OS
  allowlist. Windows tools are anchored independently to the drive of the
  already-running Node executable. Ambient boot-tool inputs must match the
  canonical set or the wrapper fails closed.
- PATH is rebuilt from canonical existing Node, Windows system, PowerShell,
  Git and validated renderer directories. Raw PATH, Node/Python injection,
  provider credentials and arbitrary controls do not cross.
- Every invocation receives distinct disposable data, database, artifact,
  approval, backup, credential, launcher, private-operator, runtime-metadata,
  assurance, profile, npm-cache and OS-temp paths.
- Both proof-path aliases are absent. The existing production resolver creates
  `proof-exposure.sqlite` beside each actual runtime database; focused proof
  resolves distinct ledgers inside the disposable root.
- Ambient live-enable and credential inputs are absent. Dry-run/privacy values
  are fixed for tests, while scheduler behavior retains its deterministic
  production default and test-local stubs remain usable.
- Invocation grammar and lifecycle quarantine are validated before renderer
  probing. Hosted lifecycle requires the exact quarantined target, exact npm
  command identity and bounded GitHub Windows job identity; flags alone cannot
  enter that mode.
- A renderer override requires a coherent absolute current/legacy alias pair;
  the only fallback is the bundled interpreter relative to the running Node
  runtime. Ambient PATH, profile and hosted-runner hints are not provenance.
- Local weighted five-way sharding, ordinary CI sharding, focused singular
  execution, deadlines, `--test-isolation=none`, fail-fast behavior and cleanup
  remain intact.
- `tmp/pdfs` remains the only explicit repository-write exception. Success and
  failure regressions prove restoration. If restore itself fails after target
  mutation, the wrapper retains and reports the only baseline recovery
  snapshot instead of deleting it.

## Disposable renderer verification and cleanup

The owner-approved environment was created once under the invoking user's
Windows temporary directory, outside the repository, from the pre-existing
local Python 3.13 interpreter. The absolute interpreter was validated; this
report represents the user-profile prefix as `%TEMP%` and does not publish it.

Exact creation/install controls were:

- base interpreter command form: `python.exe -m venv <disposable-root>`;
- `PIP_CONFIG_FILE=NUL` to disable configuration-file input;
- a pip cache contained inside the disposable root;
- `PIP_DISABLE_PIP_VERSION_CHECK=1`, `PIP_NO_INPUT=1` and
  `PYTHONNOUSERSITE=1`; and
- install command form: `<disposable-python> -m pip install
  --disable-pip-version-check --no-input -r
  <absolute-requirements-runtime.txt>`.

A name-only check found no inherited `PIP_*`, `HTTP_PROXY`, `HTTPS_PROXY`,
`ALL_PROXY` or `NO_PROXY` variable. The command made the A01-authorized narrow
package-index request for the four exact top-level requirements. It did not use
`--no-deps`, `--only-binary` or `--no-cache-dir`: the resolver added only two
required transitives, while cache writes remained inside the disposable root.

The complete final environment inventory was:

| Distribution | Version | Basis |
|---|---:|---|
| openpyxl | 3.1.5 | exact repository root requirement |
| Pillow | 12.2.0 | exact repository root requirement |
| pypdfium2 | 5.12.1 | exact repository root requirement |
| reportlab | 4.4.9 | exact repository root requirement |
| et_xmlfile | 2.0.0 | openpyxl resolver requirement |
| charset-normalizer | 3.5.1 | reportlab resolver requirement |
| pip | 25.0.1 | fresh-venv bootstrap tooling |

`pip check` returned `No broken requirements found.` Production
`checkRenderer()` passed with Python 3.13.3 and exact equality between all four
installed and pinned versions. `PANTHEON_PYTHON` and `JARVIS_PYTHON` were set
from one variable and resolved to the same validated absolute
`%TEMP%\pantheon-p0-w04-renderer-e88ed00\Scripts\python.exe` for the required
commands.

The base interpreter was probed before and after the disposable operation and
remained openpyxl 3.1.5, Pillow 12.1.1, pypdfium2 5.6.0 and reportlab 4.4.10.
The process-bundled renderer was also not modified. No repository pin changed.

After the final verification, the resolved target was proved to be the exact
named direct child of the Windows temp directory, removed recursively, and
rechecked as absent. The base interpreter versions were rechecked after
removal. P0-W04 created no persistent renderer or host repair.

The amendment's item 2 now quotes the owner's actual “environment matching the
existing pins” authority and explicitly records that this corrects the
assistant-authored `1303ce5` transcription. The four roots were the only
requested packages; bootstrap and resolver-required distributions above are
observed implementation inventory, not new pins or independent authority.

## Acceptance criteria

1. [x] The bounded name-only/synthetic-sentinel audit covers the demonstrated
   and materially adjacent inputs without owner secret values or a general
   environment schema.
2. [x] The wrapper uses a deliberate minimal child environment. Current and
   legacy writes resolve inside per-invocation disposable roots; `tmp/pdfs` is
   the sole restored repository exception.
3. [x] Focused regressions cover synthetic secrets/controls, unsafe tools,
   proof fallback, live/lifecycle quarantine, sharding, deadlines, grammar,
   cleanup and PDF restore behavior without diagnostic content disclosure.
4. [x] Focused isolation, lint and the complete ordinary inventory pass on the
   final audited candidate. Traffic is local/loopback and lifecycle is not run.
5. [x] Two genuinely no-history Codex tasks reconstructed exact W04 repository
   state from repository evidence and made no changes.
6. [x] Claude compatibility is prepared. The CLI was unavailable, so status is
   `prepared_not_verified`; no simulated rehearsal or verification claim.
7. [x] Official repository-hook support was reviewed on 2026-08-15. The
   evidence-based decision is no hook.
8. [x] No browser/T3/Playwright, global/user configuration, credential grant,
   provider/live/commercial call, spend, production change, push, PR, merge,
   P0-W05 or P1 work occurred. The sole tool/network exception was the
   owner-approved, inventoried and removed A01 renderer environment.

## Files changed

- `.github/workflows/ci.yml` — pass the hosted setup-python executable through
  both coherent aliases for ordinary CI; no hosted run is claimed.
- `AGENTS.md` — permanent concise repository-derived next-session prompt rule.
- `scripts/run-tests.js` — deliberate child environment, tool/renderer
  provenance, quarantine, cleanup and retained-recovery behavior.
- `test/test-environment-isolation.test.js` — focused isolation, lifecycle,
  renderer, PDF restore/cleanup and diagnostic-privacy regressions.
- `docs/v2/decisions/ADR-0002-NEXT-SESSION-PROMPT-CONTRACT.md` — durable owner
  protocol decision.
- `docs/v2/work-packages/P0-W04-A01-DISPOSABLE-RENDERER-AMENDMENT.md` — narrow
  renderer authority and transparent transcription correction.
- `docs/v2/evidence/packages/P0-W04/CHECKPOINT.md` — historical blocked state.
- `docs/v2/evidence/packages/P0-W04/COMPLETION.md` — this completion evidence.
- `docs/v2/PROGRESS.json`, `docs/v2/BLOCKERS.md` and
  `docs/v2/ACTIVE_HANDOFF.md` — atomic package closeout and W05-ready state.

The W03-predecessor-to-completion range contains no path under `src/`, `public/`
or `config/`; no package, lockfile or `requirements-runtime.txt` change; and no
runtime schema/database, UI, provider adapter, commercial truth, Master,
approved Phase Pack or verbatim P0-W04 execution-copy change. P0-W04-A01 is the
owner-authorized amendment and changes only through its explicitly documented
transcription correction. No repository hook was installed.

## Verification and evidence

| Check | Result | Evidence |
|---|---|---|
| final focused isolation | PASS | 5/5; 0 fail/skip/cancel |
| `npm.cmd run lint` | PASS | exit 0; zero warnings |
| production `checkRenderer()` | PASS | Python 3.13.3; four installed versions exactly equal pins |
| disposable `pip check` | PASS | no broken requirements |
| complete `npm.cmd test` | PASS | 859/859; five shards; 0 fail/skip/cancel |
| ordinary file inventory | PASS | 89 root test files = 88 ordinary + 1 quarantined lifecycle; all 88 ordinary files scheduled exactly once |
| lifecycle | N/A / excluded | exact Windows lifecycle test not run locally |
| fresh Codex reconstruction | PASS | two no-history read-only tasks; no changes |
| Claude reconstruction/handoff | `prepared_not_verified` | CLI not discoverable; no simulation |
| `node scripts/v2/status.js --check` | PASS | closed W04, W05 ready, dependency/completion consistency PASS |
| `git diff --check` | PASS | no whitespace finding after final records |
| disposable renderer cleanup | PASS | exact root removed; subsequent presence check false |

### Complete ordinary-suite result

The final audited candidate ran all five local ordinary invocations with both
aliases set to the same validated disposable interpreter:

| Shard | Files planned | Tests | Result |
|---:|---:|---:|---|
| 1/5 | 1 | 19/19 | PASS |
| 2/5 | 20 | 154/154 | PASS |
| 3/5 | 22 | 261/261 | PASS |
| 4/5 | 23 | 272/272 | PASS |
| 5/5 | 22 | 153/153 | PASS |
| **Total** | **88** | **859/859** | **PASS** |

There were no failures, skips or cancellations. The quarantined lifecycle file
was not scheduled. Renderer-dependent doctor, operations-readiness, PDF and
product-factory tests passed. Repository tests used isolated local children and
loopback traffic only; no external provider call occurred.

The earlier 19/19 plus 160/162 blocked attempt and later superseded green runs
remain diagnostic history, not final-candidate evidence. Only the 859/859 run
above followed the final hash-only PDF and synthetic-only PATH changes.

No independent byte-for-byte snapshot was taken immediately before and after
the complete run. The accurate evidence is that repository status gained no
test output path and the focused success, child-failure and restore-failure
cases compare stable tree digests and restore the baseline. This report does
not invent a separate full-run byte comparison.

## Fresh Codex reconstruction result

Two separate tasks with no conversation history and read-only instructions
reconstructed W04 from repository state alone. Across the staged checkpoint
states they recovered:

- the exact Git root, branch, predecessor and then-current dirty paths;
- P0-W01 through P0-W03 complete and W04 active/blocked at that time;
- completed criteria 1-3 and 5-8, incomplete criterion 4, and the exact
  P0-B01/P0-B02 relationship;
- Claude `prepared_not_verified`, official hook sources/no-hook decision and
  the owner-directed prompt authority;
- P0-W05 not ready at those checkpoint snapshots; and
- the exact next W04 action without making repository changes.

Their findings exposed evidence gaps that were corrected rather than hidden.
A final post-commit no-history reconstruction is an additional final-state
audit; its result is relayed after the immutable completion commit rather than
creating a self-referential evidence loop.

## Claude compatibility

`Get-Command claude -All` found no command. No version command or Claude session
was attempted, no Claude tool was installed, and no global/user configuration
was changed. `CLAUDE.md` imports `AGENTS.md`; the seven mirrored
`.agents/skills` and `.claude/skills` pairs remain byte-identical. Archived
Claude hooks/settings remain retired. Status: `prepared_not_verified`.

## Official hook review and decision

Reviewed 2026-08-15:

- Codex hooks: <https://learn.chatgpt.com/docs/hooks>
- Codex configuration reference:
  <https://learn.chatgpt.com/docs/config-file/config-reference>
- Claude Code hooks: <https://code.claude.com/docs/en/hooks>
- Claude Code configuration: <https://code.claude.com/docs/en/configuration>
- Claude Code shared memory/imports: <https://code.claude.com/docs/en/memory>

Codex supports trusted repository hook configuration in `.codex/hooks.json` or
`.codex/config.toml`; Claude project hooks belong in
`.claude/settings.json`. Both expose a Stop event. A Stop text check fires on
ordinary turns and cannot prove final verification, authoritative state,
package readiness or prompt correctness. It would add two configuration
surfaces and an untestable Claude path without preventing P0-B01. Decision:
**no hook**. No active or archived hook was created or revived.

## Decisions and deviations

- Retained the production DB-relative proof resolver rather than changing
  product semantics or imposing one proof file per shard.
- Rebuilt a canonical tool path and validated Windows boot tools rather than
  inheriting ambient PATH or Node/Python controls.
- Required exact hosted lifecycle target, command and job identity; no local
  lifecycle command was run.
- Corrected the final synthetic fixture and PDF diagnostics when independent
  review found two potential owner-value output paths, then reran focused,
  lint and the entire ordinary inventory on that exact candidate.
- Used P0-W04-A01 exactly once. The amendment record transparently corrects its
  assistant-authored initial transcription to the owner's actual formulation.
- Added the prompt rule only to `AGENTS.md`; `CLAUDE.md` inherits it. No prompt
  generator, writer, hook, daemon, database, ledger or state machine was added.
- Kept the blocked checkpoint immutable as historical evidence rather than
  rewriting its then-true facts after the amendment.

## Interactive browser / E2E / external actions

- Running application browser, T3, Playwright, screenshots and lifecycle: N/A
  and not run.
- Provider/live runtime, owner data, credential grant, customer/commercial
  action and spend: none.
- External network: only P0-W04-A01's narrow renderer package-index access.
- Tool installation: only the one disposable external renderer environment;
  no global/user install, existing-interpreter mutation or persistent tool.
- Push, PR, merge, fetch and remote mutation: none. Remote freshness remains
  unproved.

## Known limitations and blockers

There is no active W04 blocker. P0-B01 and P0-B02 are closed for this package.

- The two ambient interpreters remain mismatched and the disposable interpreter
  is deleted. P0-W05 must satisfy its own independent renderer precondition
  under W05 authority or record a gate finding; A01 cannot be borrowed.
- Claude continuity remains `prepared_not_verified` until a real provisioned
  sequential same-worktree rehearsal occurs.
- Remote freshness and inaccessible external-tool surfaces remain unproved.
- The evidenced Windows wrapper anchors system tools to the running Node drive
  and standard Git locations. A valid custom/cross-drive installation may be
  rejected fail-closed; no unsafe fallback was added in W04.

## Rollback

Before integration, a reviewed normal revert may remove the W04 isolation,
test and workflow implementation if rollback is required. That restores the
former wrapper but also reopens the demonstrated P0-B01 environment/proof risk;
it must not be described as adequate isolation. Preserve the permanent
owner-directed `AGENTS.md` prompt rule, ADR-0002 and owner-approval history
unless a recorded owner direction explicitly withdraws or supersedes them. Do
not recreate the disposable renderer, change pins, delete custody refs, rewrite
history, revive archived hooks or touch global/user configuration.

## Next ready package

P0-W05 is ready and not started. A fresh independent reviewer must reconstruct
the clean candidate, review `B..S`, perform only criteria 1-6 and the specified
gate checks without fixes, write the binary gate report and one review-state-
only commit, then stop for explicit owner decision. A green W04 result is not
the independent P0 gate, integration approval or P1 start.

## Commits and final Git status

- P0-W03 completion and initial W04 predecessor:
  `9c29d19b140c648f8100605b6479f790320be695`.
- First P0-W04 blocked checkpoint:
  `acd466410154049bfcb207a5bc85416c999517b1`.
- Continuation hardening checkpoint:
  `e88ed00ef0d204e0a33b8a9a4467a8be8657f42d`.
- Owner-amendment predecessor:
  `1303ce5149c4a5a4ecdb1e93b234b58782f8d16f`.
- The P0-W04 completion commit is the coherent commit containing this report;
  its SHA remains available from normal Git history instead of being written
  self-referentially here.
- Final state checks are run after all records are written and immediately
  before the completion commit. Push/PR/merge/remote mutation: none.
