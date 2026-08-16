# Pantheon v2.1.1 Blockers

P0-W04A resolved the two findings from the first independent Phase 0 gate and
revalidated the existing ordinary-test isolation closure. P0-W05 is ready for
one completely fresh independent review.

### P0-B01 — Closed by P0-W04 ordinary-test isolation

- **Status:** closed on 2026-08-16 by the final green P0-W04 candidate and
  revalidated on 2026-08-16 by P0-W04A.
- **Blocks:** none while focused isolation and the complete ordinary suite
  remain green.
- **Owner:** completed P0-W04; revalidated by completed P0-W04A.
- **Evidence:** `docs/v2/evidence/packages/P0-W04/COMPLETION.md`, the historical
  `docs/v2/evidence/packages/P0-W04/CHECKPOINT.md` and
  `docs/v2/evidence/packages/P0-W04A/COMPLETION.md`.
- **Original finding:** the baseline ordinary-test wrapper reused an inherited
  environment and one proof-ledger alias, so a later synthetic privacy-key
  change correctly failed closed against proof metadata written earlier.
- **Resolution:** ordinary children now receive a deliberately constructed
  per-invocation environment. Current and legacy writes are disposable, proof
  ledgers retain the production DB-relative fallback, live/lifecycle modes are
  quarantined, tool and renderer provenance is validated, and `tmp/pdfs` is
  restored after success and failure. Hash-only regression snapshots ensure a
  mismatch cannot print pre-existing PDF names or bytes.
- **Closure verification:** P0-W04 focused isolation passed 5/5 and its complete
  ordinary inventory passed 859/859. P0-W04A then passed the final focused
  57/57 command and the alias-absent ordinary suite at 19/19, 137/137, 244/244,
  308/308 and 163/163: 871/871 total with no failure, skip or cancellation.
  The quarantined Windows lifecycle test remained excluded and was not run.

### P0-B02 — Closed for P0-W04 by the approved disposable renderer

- **Status:** closed on 2026-08-16 for P0-W04 only under owner-approved
  amendment P0-W04-A01.
- **Blocks:** none; this historical ID must not be repurposed for the W05 gate.
- **Owner:** completed P0-W04.
- **Evidence:**
  `docs/v2/work-packages/P0-W04-A01-DISPOSABLE-RENDERER-AMENDMENT.md` and
  `docs/v2/evidence/packages/P0-W04/COMPLETION.md`.
- **Original finding:** neither pre-existing interpreter matched all four exact
  `requirements-runtime.txt` pins. The process-bundled renderer differed on
  Pillow; the separate local Python differed on Pillow, pypdfium2 and
  reportlab.
- **Resolution:** one disposable environment outside the repository matched
  openpyxl 3.1.5, Pillow 12.2.0, pypdfium2 5.12.1 and reportlab 4.4.9. Both
  Python aliases identified the same validated absolute interpreter for the
  final focused and complete ordinary runs. The fresh-environment bootstrap
  and resolver-required distributions are fully inventoried in the completion
  report; no repository pin or existing interpreter changed.
- **Cleanup:** the exact disposable root was removed after verification and
  its absence was rechecked. The ambient interpreters remain mismatched; W04
  made no permanent host repair.

P0-B04 below tracks the separate durable renderer correction without rewriting
this historical W04-only closure.

## P0-B03 — Candidate-range documentation formatting contract fails

- **Status:** closed on 2026-08-16 by P0-W04A implementation checkpoint
  `b15f0042f513b4539feb3e6cbb93b26e8a1f91fe`.
- **Blocks:** none; P0-W05 may begin a fresh independent review.
- **Owner:** completed P0-W04A.
- **Evidence:** `P0-GATE-F01` in
  `docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW.md` and
  `docs/v2/evidence/packages/P0-W04A/COMPLETION.md`.
- **Finding:** the required baseline-to-candidate `git diff --check` exits 1
  with 30 trailing-whitespace findings and five surplus EOF blank-line findings
  across 12 P0 documentation paths.
- **Closure verification:** committed blobs prove exactly 30 terminal
  two-space-to-backslash substitutions and five surplus EOF blank removals,
  with execution-copy bodies otherwise exact. The complete baseline range
  passes `git diff --check`; the original report remains the unchanged R1 blob
  `6928a40ea2c1f0af493e728e6a71084d13291089`.

## P0-B04 — Durable exact renderer environment is unavailable

- **Status:** closed on 2026-08-16 by P0-W04A implementation checkpoint
  `b15f0042f513b4539feb3e6cbb93b26e8a1f91fe`.
- **Blocks:** none; P0-W05 may begin a fresh independent review.
- **Owner:** completed P0-W04A.
- **Evidence:** `P0-GATE-F02` in
  `docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW.md` and the owner-approved
  `docs/v2/work-packages/P0-W04A.md`, with completion evidence in
  `docs/v2/evidence/packages/P0-W04A/COMPLETION.md`.
- **Finding:** the W04 one-use environment was deleted, the existing local
  candidates do not satisfy all exact pins and ordinary test/runtime discovery
  can depend on managed-Python coincidence. The first gate's full ordinary
  command therefore could not pass.
- **Closure verification:** the final clean bootstrap created the ignored
  canonical CPython 3.13.3 environment from the newest reviewed exact pins;
  standalone validation, safe reuse, `pip check`, focused 57/57, recovery
  19/19, production 28/28, lint and the alias-absent ordinary 871/871 suite all
  pass. No global/user interpreter or configuration changed.

## Current Phase 0 state

P0-W04A is complete. P0-W05 is the sole ready package and its review must be
completely fresh. The original failed gate report and commit
`75914d954cbf78b7bf4695eed2f135ea1bb627ac` remain valid evidence and must not
be changed. The new review writes `PHASE-GATE-REVIEW-02.md` instead.

The reviewed pre-existing work remains preserved on
`pantheon-v2.1.1-programme` at unverified checkpoint
`612a35c8b1d881f638570373d06f99d26bfb280e`; local `main` remains baseline
`718e50670812ad5da7210bd9f183521328cccf93`. Remote freshness remains unproved.

The governing Phase 0 Execution Pack retains approved identifier `0.2-draft`.
Claude continuity remains honestly `prepared_not_verified`; no Claude CLI was
available and no rehearsal was simulated.

Browser/T3/Playwright and local lifecycle remain excluded. No provider,
live/commercial, owner-data, integration or P1 action is authorized.
