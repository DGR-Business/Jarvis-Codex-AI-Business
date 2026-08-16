# Pantheon v2.1.1 Blockers

P0-W04A is ready to resolve two active findings from the first independent
Phase 0 gate. P0-W05 is dependency-pending and must not be rerun until W04A
actually passes.

### P0-B01 — Closed by P0-W04 ordinary-test isolation

- **Status:** closed on 2026-08-16 by the final green P0-W04 candidate; W04A
  must revalidate this closure before completion.
- **Blocks:** none while focused isolation and the complete ordinary suite
  remain green.
- **Owner:** completed P0-W04; regression handling belongs to P0-W04A.
- **Evidence:** `docs/v2/evidence/packages/P0-W04/COMPLETION.md` and the
  historical `docs/v2/evidence/packages/P0-W04/CHECKPOINT.md`.
- **Original finding:** the baseline ordinary-test wrapper reused an inherited
  environment and one proof-ledger alias, so a later synthetic privacy-key
  change correctly failed closed against proof metadata written earlier.
- **Resolution:** ordinary children now receive a deliberately constructed
  per-invocation environment. Current and legacy writes are disposable, proof
  ledgers retain the production DB-relative fallback, live/lifecycle modes are
  quarantined, tool and renderer provenance is validated, and `tmp/pdfs` is
  restored after success and failure. Hash-only regression snapshots ensure a
  mismatch cannot print pre-existing PDF names or bytes.
- **Closure verification:** P0-W04 focused isolation passed 5/5. The complete ordinary
  inventory—88 files in five shards—passes 19/19, 154/154, 261/261, 272/272
  and 153/153: 859/859 total with no failure, skip or cancellation. The
  quarantined Windows lifecycle test was excluded and not run. W04A must rerun
  focused isolation and the complete ordinary suite; reopen P0-B01 if either
  exposes an isolation regression.

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

- **Status:** open from failed gate review `R1`; assigned to P0-W04A.
- **Blocks:** any P0-W05 rerun or integration.
- **Owner:** P0-W04A.
- **Evidence:** `P0-GATE-F01` in
  `docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW.md`.
- **Finding:** the required baseline-to-candidate `git diff --check` exits 1
  with 30 trailing-whitespace findings and five surplus EOF blank-line findings
  across 12 P0 documentation paths.
- **Closure rule:** close only after the authorized mechanical corrections make
  the complete baseline-to-new-candidate range pass with no semantic wording
  change and the original failed report remains untouched.

## P0-B04 — Durable exact renderer environment is unavailable

- **Status:** open from failed gate review `R1`; assigned to P0-W04A.
- **Blocks:** any P0-W05 rerun or integration.
- **Owner:** P0-W04A.
- **Evidence:** `P0-GATE-F02` in
  `docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW.md` and the owner-approved
  `docs/v2/work-packages/P0-W04A.md`.
- **Finding:** the W04 one-use environment was deleted, the existing local
  candidates do not satisfy all exact pins and ordinary test/runtime discovery
  can depend on managed-Python coincidence. The first gate's full ordinary
  command therefore could not pass.
- **Closure rule:** close only after a clean bootstrap creates the canonical
  ignored environment, exact validation and discovery tests pass, the selected
  final exact pins pass renderer/Doctor/artifact checks, lint and one complete
  ordinary suite pass, and no global/user interpreter is changed.

## Current Phase 0 state

P0-W04A is the sole ready package. P0-W05 is dependency-pending behind W04A and
its next review must be completely fresh. The original failed gate report and
commit `75914d954cbf78b7bf4695eed2f135ea1bb627ac` remain valid evidence and must
not be changed. A successful rerun writes `PHASE-GATE-REVIEW-02.md` instead.

The reviewed pre-existing work remains preserved on
`pantheon-v2.1.1-programme` at unverified checkpoint
`612a35c8b1d881f638570373d06f99d26bfb280e`; local `main` remains baseline
`718e50670812ad5da7210bd9f183521328cccf93`. Remote freshness remains unproved.

The governing Phase 0 Execution Pack retains approved identifier `0.2-draft`.
Claude continuity remains honestly `prepared_not_verified`; no Claude CLI was
available and no rehearsal was simulated.

Browser/T3/Playwright and local lifecycle remain excluded. No provider,
live/commercial, owner-data, integration or P1 action is authorized.
