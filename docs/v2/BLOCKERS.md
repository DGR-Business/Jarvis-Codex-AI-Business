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
  controls to safe test values. It anchors Windows tools to the drive of the
  already-running Node executable, rebuilds PATH from validated canonical tool
  roots, rejects even coherent ambient replacement trees, and accepts a renderer
  only from the bundled runtime relative to the running Node executable or a
  coherent explicit current/legacy absolute pair. Ambient PATH, profiles and
  hosted-runner Python hints are not renderer provenance.
- **Focused verification:** the isolation suite passes 5/5 and the original
  journey regression plus wrapper sharding/quarantine tests pass 11/11. The
  focused wrapper test includes a real child exit failure, exact PDF restore
  and disposable-root cleanup. A separate partial-restore failure retains and
  reports the only baseline recovery snapshot instead of deleting it; the test
  proves recovery before restoring and cleaning the synthetic failure. The
  required complete ordinary run cannot close this blocker until P0-B02 is
  resolved; do not weaken the proof-ledger fail-closed behavior.

## P0-B02 — Exact renderer environment is not provisioned

- **Status:** active D-class precondition; P0-W04-A01 approved, disposable exact environment pending.
- **Owner:** P0-W04 under approved amendment P0-W04-A01.
- **Blocks:** the required green complete ordinary suite, formal P0-B01 closure,
  P0-W04 completion and the P0-W05 gate.
- **Evidence:** two pre-existing interpreters were discovered read-only and
  neither satisfies `requirements-runtime.txt`. The Codex-bundled renderer has
  openpyxl 3.1.5, Pillow 12.3.0, pypdfium2 5.12.1 and reportlab 4.4.9, so its
  production `checkRenderer()` fails only Pillow against the 12.2.0 pin. The
  separate local Python 3.13 has openpyxl 3.1.5, Pillow 12.1.1, pypdfium2 5.6.0
  and reportlab 4.4.10, so it has three mismatches. Neither interpreter was
  changed or installed by P0-W04.
- **Required full-run result:** the one required `npm.cmd test` attempt passed
  shard 1 at 19/19. Shard 2 passed 160/162; its two failures were the doctor's
  exact renderer-package-pin test and the transitive operations-ready doctor
  CLI test. Fail-fast then left shards 3 through 5 unrun. That attempt preceded
  final review fixes; the final candidate's affected focused checks are green,
  but it has no complete-suite green claim.
- **Approved resolution path:** P0-W04-A01 permits one disposable environment
  using the existing pins and requires both Python aliases to identify the same
  validated absolute interpreter. It permits no pin or production-contract
  change and no mutation of either existing interpreter. Close this blocker
  only after exact version validation and the complete ordinary suite pass.

P0-W01 through P0-W03 are complete. W01's required run is a safely isolated,
truthful observed red result rather than a false green claim. The reviewed
pre-existing work
remains preserved on `pantheon-v2.1.1-programme` at unverified checkpoint
`612a35c8b1d881f638570373d06f99d26bfb280e`; local `main` remains baseline
`718e50670812ad5da7210bd9f183521328cccf93`.

The ambient renderer limitation remains active blocker P0-B02 until the
P0-W04-A01 disposable environment is validated and used for a green complete
ordinary suite. W01's earlier disposable environment was deleted after use and
did not mutate either discovered interpreter.

The governing Phase 0 Execution Pack is owner-approved; its approved pack
identifier remains `0.2-draft`. P0-W02 reconciled the known programme-version,
progress-schema, authority, session and shared-skill contract issues; they are
no longer limitations or blockers. P0-W04 has resumed under P0-W04-A01 but
P0-B01/P0-B02 remain open until the required suite is green; P0-W05 is not
ready.
