# Pantheon v2.1.1 Blockers

## P0-B01 — Ordinary proof-ledger isolation awaits full-suite closure

- **Status:** implementation repaired and targeted-verified; formal closure blocked by P0-B02.
- **Package history:** nonblocking for completed P0-W02 and P0-W03.
- **Owner:** P0-W04 under the approved Phase 0 Execution Pack.
- **Blocks:** a green ordinary-suite claim, P0-W04 completion and the P0-W05
  gate. It does not block the approved authority/static work in P0-W02 or the
  bounded continuity-tool work in P0-W03.
- **Evidence:** `docs/v2/evidence/packages/P0-W01/COMPLETION.md` and
  `docs/v2/evidence/packages/P0-W04/CHECKPOINT.md`.
- **Original finding:** baseline `scripts/run-tests.js` reused one inherited environment
  for all temporary runtimes and shards. W01's required non-empty current and
  legacy proof-ledger aliases therefore resolve to one SQLite file. The focused
  proof test deliberately changes the protected test key and correctly fails
  closed against metadata created under the earlier key.
- **Classification:** B — pre-existing failure in the ordinary-test-isolation
  domain. There is no P0-W01 source or test delta.
- **Coverage limitation:** the fail-fast command executed 703 tests across four
  shards (702 pass, one fail); shard five did not run and is not claimed green.
- **Implemented resolution:** P0-W04 now creates a deliberate disposable child
  environment per invocation, excludes both hostile proof-path aliases and
  retains the production DB-relative fallback, redirects current and legacy
  write paths, excludes inherited live enables and fixes dry-run/privacy
  controls to safe test values.
- **Focused verification:** the isolation suite passes 5/5 and the original
  journey regression plus wrapper sharding/quarantine tests pass 11/11. The
  required complete ordinary run cannot close this blocker until P0-B02 is
  resolved; do not weaken the proof-ledger fail-closed behavior.

## P0-B02 — Exact renderer environment is not provisioned

- **Status:** active D-class environment/tool precondition; owner action required.
- **Owner:** repository owner for a narrowly authorized renderer setup or
  separately approved dependency-pin decision.
- **Blocks:** the required green complete ordinary suite, formal P0-B01 closure,
  P0-W04 completion and the P0-W05 gate.
- **Evidence:** the only discovered interpreter is the Codex-bundled renderer.
  Its exact package probe and production `checkRenderer()` report openpyxl
  3.1.5, Pillow 12.3.0, pypdfium2 5.12.1 and reportlab 4.4.9; only Pillow differs
  from `requirements-runtime.txt`, which pins 12.2.0.
- **Required full-run result:** the one required `npm.cmd test` attempt passed
  shard 1 at 19/19. Shard 2 passed 160/162; its two failures were the doctor's
  exact renderer-package-pin test and the transitive operations-ready doctor
  CLI test. Fail-fast then left shards 3 through 5 unrun. That attempt preceded
  final review fixes; the final candidate's affected focused checks are green,
  but it has no complete-suite green claim.
- **Required owner action:** either authorize creation of one disposable exact
  renderer environment using the existing repository pins, or separately
  approve a dependency-pin change. The disposable option must set both Python
  aliases to the same validated absolute interpreter. P0-W04 does not authorize
  tool installation or a production dependency-contract change, so it must not
  loosen, fake or bypass this check.

P0-W01 through P0-W03 are complete. W01's required run is a safely isolated,
truthful observed red result rather than a false green claim. The reviewed
pre-existing work
remains preserved on `pantheon-v2.1.1-programme` at unverified checkpoint
`612a35c8b1d881f638570373d06f99d26bfb280e`; local `main` remains baseline
`718e50670812ad5da7210bd9f183521328cccf93`.

The ambient renderer limitation is now active blocker P0-B02. W01's disposable
exact environment did not mutate the bundled tool, and P0-W04 has neither
changed the pin nor installed tooling.

The governing Phase 0 Execution Pack is owner-approved; its approved pack
identifier remains `0.2-draft`. P0-W02 reconciled the known programme-version,
progress-schema, authority, session and shared-skill contract issues; they are
no longer limitations or blockers. P0-W04 is blocked only on P0-B02's exact
renderer precondition; P0-W05 is not ready.
