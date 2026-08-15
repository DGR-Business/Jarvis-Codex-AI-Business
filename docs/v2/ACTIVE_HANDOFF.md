# Active Handoff

**Package:** P0-W04
**Status:** blocked
**Current writing agent:** Codex
**Worktree/branch:** `C:\Pantheon-worktrees\P0-engineering-os` / `codex/p0-engineering-os`
**Updated:** 2026-08-15T23:12:58+10:00

## Objective

Close the demonstrated ordinary-test environment escapes without changing
Pantheon production/business semantics, preserve the existing wrapper
behaviour, prove repository-only fresh-session reconstruction, prepare or
genuinely verify sequential Claude continuity, and make an evidence-based
repository-hook decision. Also install the concise permanent next-session
copy/paste-prompt rule required by the owner for future package sessions.

## Completed and verified

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
- Final-code focused checks pass: isolation 5/5; journey/wrapper 11/11;
  runtime 83/83; product/full-journey 2/2; status fixtures 6/6; lint clean.
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

- Files actively changed: `scripts/run-tests.js`,
  `test/test-environment-isolation.test.js`, `AGENTS.md`,
  `docs/v2/PROGRESS.json`, `docs/v2/BLOCKERS.md` and
  `docs/v2/ACTIVE_HANDOFF.md`, plus the W04 blocked checkpoint report.
- Checkpoint state: the coherent W04 blocked checkpoint is the commit containing
  this handoff; its SHA is available through normal Git history.
- Checkpoint predecessor:
  `9c29d19b140c648f8100605b6479f790320be695`; the checkpoint commit is the
  commit containing the final handoff/evidence and is not self-recorded.
- Current diagnosis: P0-B01's source defect is repaired without changing
  production semantics; the focused journey failure is green. The known
  independent renderer precondition remains Pillow 12.3.0 versus the exact
  12.2.0 pin, with no second interpreter currently provisioned.

## Verification

| Command or check | Result | Evidence |
|---|---|---|
| Starting Git root/branch/status/history | PASS | expected root/branch, clean `9c29d19` |
| W03 closed-state `node scripts/v2/status.js --check` | PASS | dependency/completion consistency passed before activation |
| Focused W04 isolation tests | PASS | 5/5 |
| Journey + wrapper regressions | PASS | 11/11 |
| Runtime compatibility | PASS | final candidate 83/83 |
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
- P0-B02 is active: the only discovered renderer is Pillow 12.3.0 against the
  repository's exact 12.2.0 pin, and `checkRenderer()` fails this precondition.
  W04 may not install tooling or change the production dependency contract.
  Owner action must authorize a disposable exact renderer or a separate pin
  decision; the check must not be weakened, faked or bypassed.
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
- The permanent prompt rule is an additive direct owner instruction for this
  session, recorded in the W04 evidence. It does not amend product/package
  scope, readiness or verification criteria.

## Receiving-agent instructions

- Read the governing files and run `node scripts/v2/status.js --check` before
  editing.
- Preserve the W01 custody refs, W02/W03 commits, P0-B01 evidence and any valid
  in-scope W04 changes.
- Continue only P0-W04; do not begin P0-W05 or claim Claude verification without
  a real sequential same-worktree rehearsal.

## Exact next action

Obtain owner authorization for one disposable exact renderer environment using
the existing pins (setting both Python aliases to the same validated absolute
interpreter), or a separately approved dependency-pin decision. Continue only
P0-W04 and do not rerun the full suite or begin P0-W05 until that precondition
is resolved.
