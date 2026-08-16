# Pantheon v2.1.1 Blockers

There are no active Phase 0 blockers. P0-W01 through P0-W04 are complete;
P0-W05 is ready but has not started.

### P0-B01 — Closed by P0-W04 ordinary-test isolation

- **Status:** closed on 2026-08-16 by the final green P0-W04 candidate.
- **Blocks:** none.
- **Owner:** completed P0-W04.
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
- **Closure verification:** focused isolation passes 5/5. The complete ordinary
  inventory—88 files in five shards—passes 19/19, 154/154, 261/261, 272/272
  and 153/153: 859/859 total with no failure, skip or cancellation. The
  quarantined Windows lifecycle test was excluded and not run.

### P0-B02 — Closed for P0-W04 by the approved disposable renderer

- **Status:** closed on 2026-08-16 under owner-approved amendment P0-W04-A01.
- **Blocks:** none.
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

## Current Phase 0 state

P0-W05 requires its own fresh independent gate session, test environment and
authority. P0-W04-A01 granted no W05 installation authority and its removed
renderer is not available to the gate. A W05 renderer precondition must be
satisfied within W05's own authority or recorded as a gate finding; it must not
borrow the W04 amendment.

The reviewed pre-existing work remains preserved on
`pantheon-v2.1.1-programme` at unverified checkpoint
`612a35c8b1d881f638570373d06f99d26bfb280e`; local `main` remains baseline
`718e50670812ad5da7210bd9f183521328cccf93`. Remote freshness remains unproved
because P0-W04 performed no fetch, push, PR or merge.

The governing Phase 0 Execution Pack retains approved identifier `0.2-draft`.
Claude continuity remains honestly `prepared_not_verified`; no Claude CLI was
available and no rehearsal was simulated.
