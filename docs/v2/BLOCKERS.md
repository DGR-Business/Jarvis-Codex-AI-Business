# Pantheon v2.1.1 Blockers

## P0-B01 — Ordinary proof-ledger isolation is not yet green

- **Status:** active Phase 0 limitation; nonblocking for P0-W03. It did not
  block completed P0-W02.
- **Owner:** P0-W04 under the approved Phase 0 Execution Pack.
- **Blocks:** a green ordinary-suite claim, P0-W04 completion and the P0-W05
  gate. It does not block the approved authority/static work in P0-W02 or the
  bounded continuity-tool work in P0-W03.
- **Evidence:** `docs/v2/evidence/packages/P0-W01/COMPLETION.md`.
- **Finding:** baseline `scripts/run-tests.js` reuses one inherited environment
  for all temporary runtimes and shards. W01's required non-empty current and
  legacy proof-ledger aliases therefore resolve to one SQLite file. The focused
  proof test deliberately changes the protected test key and correctly fails
  closed against metadata created under the earlier key.
- **Classification:** B — pre-existing failure in the ordinary-test-isolation
  domain. There is no P0-W01 source or test delta.
- **Coverage limitation:** the fail-fast command executed 703 tests across four
  shards (702 pass, one fail); shard five did not run and is not claimed green.
- **Required resolution:** P0-W04 must preserve per-runtime isolation while
  proving that both inherited proof aliases cannot escape the disposable root,
  add focused regressions, and obtain its required green full ordinary suite.
  Do not repair the wrapper early in P0-W02 or P0-W03.

P0-W01 and P0-W02 are complete. W01's required run is a safely isolated,
truthful observed red result rather than a false green claim. The reviewed
pre-existing work
remains preserved on `pantheon-v2.1.1-programme` at unverified checkpoint
`612a35c8b1d881f638570373d06f99d26bfb280e`; local `main` remains baseline
`718e50670812ad5da7210bd9f183521328cccf93`.

The governing Phase 0 Execution Pack is owner-approved; its approved pack
identifier remains `0.2-draft`. P0-W02 reconciled the known programme-version,
progress-schema, authority, session and shared-skill contract issues; they are
no longer limitations or blockers. P0-W03 is ready, and no owner action is
required before its fresh implementation session.
