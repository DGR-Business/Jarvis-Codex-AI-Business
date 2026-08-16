# Active Handoff

**Package:** P0-W04
**Status:** in_progress
**Current writing agent:** Codex
**Worktree/branch:** `C:\Pantheon-worktrees\P0-engineering-os` / `codex/p0-engineering-os`
**Updated:** 2026-08-16T10:11:48+10:00

## Objective

Close the demonstrated ordinary-test environment escapes without changing
Pantheon production/business semantics, preserve the existing wrapper
behaviour, prove repository-only fresh-session reconstruction, prepare or
genuinely verify sequential Claude continuity, and make an evidence-based
repository-hook decision. Also install the concise permanent next-session
copy/paste-prompt rule required by the owner for future package sessions.

## Completed and verified

- The owner approved P0-W04-A01 on 2026-08-16. It narrowly permits one
  disposable environment containing the existing exact renderer pins, the two
  coherent Python aliases, required W04 verification, and cleanup. It changes
  no pin, existing interpreter, production semantic or later-package scope.

- Reconstructed the package from `AGENTS.md`, `CLAUDE.md`, the stable Master,
  approved Phase 0 Pack and W04 copy, ADR-0001, W01-W03 completion records, the
  three active state files, Git history and the W03 status-helper contract.
- Confirmed the exact root, branch and clean starting HEAD:
  `9c29d19b140c648f8100605b6479f790320be695`.
- Confirmed W01-W03 complete and W04 ready before activation.
- Confirmed `Get-Command claude` does not find a provisioned Claude CLI; the
  current honest compatibility label remains `prepared_not_verified`.
- Completed the name-only audit without reading values. The ambient shell has
  legacy privacy, live, cost and passphrase controls plus Node tool overrides,
  demonstrating why deny-by-default construction is required.
- Replaced the wrapper's inherited denylist with a deliberate per-invocation
  environment. Current/legacy write paths and profile/cache/temp roots are
  disposable; synthetic privacy/live controls are fixed; proof-path aliases
  are omitted so the existing DB-relative production fallback stays isolated.
- Added focused regressions for child sentinels, resolved proof paths, modes,
  deadlines, focused grammar, lifecycle quarantine, renderer validation, PDF
  restoration and failure cleanup.
- Focused W04 isolation tests pass 5/5. The original journey regression plus
  wrapper sharding/quarantine tests pass 11/11. Lint passes.
- Reviewed current official Codex and Claude hook documentation dated
  2026-08-15. Both support repository hooks; the decision is no hook because a
  Stop text check cannot prove repository readiness and would add untestable
  configuration without preventing P0-B01.
- Added the permanent shared `NEXT SESSION — COPY/PASTE PROMPT` rule to
  `AGENTS.md`; `CLAUDE.md` inherits it through its existing import.
- Ran the one required complete ordinary-suite attempt. Shard 1 passed 19/19;
  shard 2 passed 160/162, with both failures caused solely by Pillow 12.3.0 not
  matching the exact 12.2.0 renderer pin. Fail-fast left shards 3-5 unrun.
- Independent review found scheduler, raw PATH, lifecycle-entry,
  renderer-probe-order and launcher-path gaps in the first implementation.
  Those were repaired before checkpoint evidence was frozen.
- A post-checkpoint strict audit then found raw Windows boot-tool inputs,
  profile-derived renderer discovery and failure cleanup that did not survive a
  restore exception. The wrapper now anchors Windows tools to the drive of the
  already-running Node executable, rejects even a coherent ambient replacement
  tree, and accepts only explicit-pair or process-bundled renderer provenance.
  Its regression launches a real failing child. If restoration fails after
  target mutation, the wrapper retains and reports the baseline recovery
  snapshot; the regression proves recovery before cleaning its synthetic case.
- The hosted ordinary-CI workflow is configured to supply the setup-python
  executable through both coherent renderer aliases; no hosted run is claimed.
  Lifecycle entry additionally requires the exact npm lifecycle command
  identity as well as the exact target and bounded hosted job identity; flags
  alone cannot select lifecycle mode.
- Recorded the explicit owner-directed prompt contract durably in ADR-0002;
  this additive protocol decision creates no product scope or continuity
  subsystem.
- Final-code focused checks pass: isolation 5/5; journey/wrapper 11/11;
  runtime 83/83; product/full-journey 2/2; status fixtures 6/6; lint clean.
- The no-alias runtime characterization passed 67/83 and failed 16 renderer-
  dependent cases with `python` absent. This is expected after removing ambient
  profile discovery, not a green compatibility claim. Supplying the same
  validated absolute process-bundled interpreter through both aliases produced
  the recorded 83/83 result.
- A final independent wrapper re-audit found no actionable issue after the
  boot-tool provenance and retained-recovery fixes. It ran no lifecycle or full
  suite and made no changes.
- A no-history read-only Codex task reconstructed the exact root, branch, HEAD,
  dirty paths, dependency chain, completed/remaining criteria, P0-B01/P0-B02
  and the stop before P0-W05. It made no changes and exposed three evidence
  gaps that were then corrected.
- A second no-history read-only task reconstructed the seven-path final
  checkpoint candidate, confirmed consistency PASS, distinguished
  `CHECKPOINT.md` from an absent completion marker, found the official hook
  sources and owner instruction, and again stopped before P0-W05 without edits.

## Remaining acceptance criteria

- [x] Finish the name-only/synthetic-sentinel environment audit.
- [x] Replace broad inherited environment handling with the smallest evidenced
  safe child environment and disposable current/legacy write paths.
- [x] Add focused isolation regressions while preserving sharding, deadlines,
  focused-path grammar, PDF restoration, cleanup and lifecycle quarantine.
- [ ] Obtain one green complete ordinary suite. The required attempt was made
  once and is blocked by P0-B02's exact renderer precondition.
- [x] Complete and record a genuinely fresh Codex reconstruction rehearsal.
- [x] Prepare Claude compatibility and record `prepared_not_verified` honestly
  because Claude is unavailable; do not simulate a rehearsal.
- [x] Complete the dated official hook review and record the hook/no-hook
  decision.
- [x] Add the permanent concise next-session copy/paste-prompt protocol rule.
- [x] Pass final status/diff checks and commit one coherent verified blocked
  checkpoint (the commit containing this handoff). Do not label the package
  complete.

## Current working state

- Continuation-checkpoint files after the first checkpoint:
  `.github/workflows/ci.yml`,
  `scripts/run-tests.js`, `test/test-environment-isolation.test.js`,
  `docs/v2/decisions/ADR-0002-NEXT-SESSION-PROMPT-CONTRACT.md`, the three normal
  state files and this checkpoint report.
- Prior coherent blocked checkpoint:
  `acd466410154049bfcb207a5bc85416c999517b1`. The continuation checkpoint is
  the coherent commit containing this handoff; its own SHA is discoverable in
  normal Git history and intentionally not self-recorded.
- Initial W04 predecessor:
  `9c29d19b140c648f8100605b6479f790320be695`.
- Current diagnosis: P0-B01's source defect is repaired without changing
  production semantics; the focused journey failure is green. Two pre-existing
  interpreters were inspected read-only: the process-bundled renderer differs
  on Pillow 12.3.0 versus 12.2.0, while the separate local Python differs on
  Pillow, pypdfium2 and reportlab. No exact interpreter is provisioned.

## Verification

| Command or check | Result | Evidence |
|---|---|---|
| Starting Git root/branch/status/history | PASS | expected root/branch, clean `9c29d19` |
| W03 closed-state `node scripts/v2/status.js --check` | PASS | dependency/completion consistency passed before activation |
| Focused W04 isolation tests | PASS | 5/5 |
| Journey + wrapper regressions | PASS | 11/11 |
| Runtime compatibility | PASS | final candidate 83/83 with both explicit aliases set to the validated process-bundled renderer |
| Runtime without explicit renderer provenance | EXPECTED PRECONDITION | 67/83; 16 renderer-dependent failures because ambient profile discovery is prohibited |
| Product/full-journey focused files | PASS | 2/2 |
| Status-helper fixtures | PASS | 6/6; sanitized PATH retains Git |
| `npm.cmd run lint` | PASS | zero warnings |
| complete `npm.cmd test` | BLOCKED (D) | earlier candidate: shard 1 19/19; shard 2 160/162; both observed failures are the exact Pillow pin precondition; shards 3-5 unrun; no final-code green claim |
| fresh Codex reconstruction | PASS | no-history read-only task, no changes |
| Claude continuity | `prepared_not_verified` | CLI unavailable; no simulated rehearsal |
| final status/diff checks | PASS | consistency PASS; no whitespace finding |

## Current failures or blockers

- P0-B01's wrapper repair and exact focused regression are green, but formal
  closure awaits a complete green ordinary run.
- P0-B02 is active: neither discovered interpreter satisfies the exact package
  pins. Default `checkRenderer()` finds the process-bundled renderer and fails
  Pillow 12.3.0 against the repository's exact 12.2.0 pin.
  W04 may not install tooling or change the production dependency contract.
  Because W04 prohibits installation and dependency-contract changes, owner
  action must approve a narrow Pack/W04 amendment for a one-use disposable exact
  renderer or a separately scoped pin amendment. The check must not be weakened,
  faked or bypassed.
- Claude is unavailable, so a real cross-model rehearsal cannot currently be
  performed. This is nonblocking under the approved Pack and must remain
  `prepared_not_verified`.
- Remote freshness and inaccessible external-tool surfaces remain unproved;
  neither requires or authorizes remote/global inspection in W04.

## Decisions and constraints

- One writer owns this worktree. Parallel assistance is read-only.
- Do not change `src/`, `public/`, runtime/database, UI, provider or commercial
  semantics to resolve the test-only defect.
- Do not run the quarantined Windows lifecycle test locally.
- No browser/T3/Playwright, provider calls, tool installation, credentials,
  spend, global/user configuration, push, merge, P0-W05 or P1 work.
- Keep `scripts/v2/status.js` read-only and bounded; no prompt generator,
  handoff writer, daemon, database or orchestration subsystem.
- ADR-0002 durably records the permanent prompt rule as an additive direct
  owner instruction. It does not amend product/package scope, readiness or
  verification criteria.

## Receiving-agent instructions

- Read the governing files and run `node scripts/v2/status.js --check` before
  editing.
- Preserve the W01 custody refs, W02/W03 commits, P0-B01 evidence and any valid
  in-scope W04 changes.
- Continue only P0-W04; do not begin P0-W05 or claim Claude verification without
  a real sequential same-worktree rehearsal.

## Exact next action

Create and validate the single disposable exact renderer authorized by
P0-W04-A01, set both Python aliases to its absolute interpreter, and run the
required focused isolation test, lint and one complete ordinary suite. Continue
only P0-W04; do not run lifecycle or begin P0-W05.
