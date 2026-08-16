# Pantheon v2.1.1 Blockers

Phase 0 is closed. The third independent gate passed, the owner explicitly
approved exact candidate S3 and report commit R3 on 2026-08-16, and local
`main` was fast-forwarded to exact R3 with a docs-only closeout commit. No
technical blocker is active. All entries below are historical closures.

### P0-B01 — Closed by P0-W04 ordinary-test isolation

- **Status:** closed on 2026-08-16 by the final green P0-W04 candidate and
  revalidated on 2026-08-16 by P0-W04A and P0-W04B.
- **Blocks:** none while focused isolation and the complete ordinary suite
  remain green.
- **Owner:** completed P0-W04; revalidated by completed P0-W04A and P0-W04B.
- **Evidence:** `docs/v2/evidence/packages/P0-W04/COMPLETION.md`, the historical
  `docs/v2/evidence/packages/P0-W04/CHECKPOINT.md`,
  `docs/v2/evidence/packages/P0-W04A/COMPLETION.md` and
  `docs/v2/evidence/packages/P0-W04B/COMPLETION.md`.
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
  P0-W04B then passed focused isolation at 61/61 and the alias-absent ordinary
  suite at 19/19, 167/167, 236/236, 292/292 and 161/161: 875/875 total with no
  failure, skip or cancellation. The quarantined Windows lifecycle test
  remained excluded and was not run.

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
- **Blocks:** none; fresh Review 03 revalidated the formatting closure.
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

- **Status:** closed on 2026-08-16 by P0-W04B implementation checkpoint
  `f0ee7662cc4e6ccb5f81fa0f000998964b740221`; it was reopened by exact review
  commit `d4819528050b42a2dcefea590c106d912fc5e0cf`.
- **Blocks:** none; fresh Review 03 passed. Integration and Phase 0 exit still
  require separate owner approval of exact S3 and R3.
- **Owner:** completed P0-W04B.
- **Evidence:** `P0-GATE-02-F01` in
  `docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW-02.md`, the owner-approved
  `docs/v2/work-packages/P0-W04B.md`,
  `docs/v2/RENDERER_ENVIRONMENT.md` and
  `docs/v2/evidence/packages/P0-W04B/COMPLETION.md`.
- **Original finding and historical closure:** P0-W04A correctly replaced the
  deleted W04 one-use environment with an ignored checkout-local CPython 3.13
  environment and proved the four exact direct roots, imports, isolation,
  `pip check`, shared resolver and ordinary regression. That closed the first
  gate's narrower availability finding at implementation checkpoint
  `b15f0042f513b4539feb3e6cbb93b26e8a1f91fe`.
- **Reopened finding:** validation compares only the four direct roots and
  ordinary root-only resolution does not govern the observed transitives or
  seeded pip. Unexpected distributions, changed or missing transitives,
  duplicate normalized metadata and changed tooling can pass or be reused.
- **Required closure:** the canonical environment must contain exactly one
  normalized metadata record for each of openpyxl 3.1.5, Pillow 12.3.0,
  pypdfium2 5.13.0, reportlab 5.0.0, charset-normalizer 3.5.1, et_xmlfile 2.0.0
  and pip 26.2.1, with nothing else. Fresh bootstrap and immediate safe reuse,
  base/interpreter provenance, isolation/import/`pip check`, hosted CI,
  Doctor/product/approval/recovery resolution, focused regressions and the full
  alias-absent ordinary suite must all pass before closure.
- **Closure verification:** I2 governs the exact seven-item inventory with root
  requirements SHA-256 `f7f726ac93a6ccf6a748bce73fa467b39b9e9cc0940153b291d44c3d85208b77`
  and lock SHA-256 `e89141b3031ce59ee3ce9560378efb7ee6b2dd20b2cd5e95592822565994bd53`.
  Clean bootstrap reported `reused=false`, standalone validation and
  `pip check` passed, and immediate reuse reported `reused=true`. Focused checks
  passed 61/61, encrypted recovery 19/19, production rendering 28/28, lint was
  clean, and the alias-absent ordinary suite passed 875/875 with zero failure,
  skip or cancellation.

## Current Phase 0 state

Phase 0 is complete. Review 03 passed against exact candidate S3
`79021c548237ee4cdf14f234f382003a0bc6408a`; the owner explicitly approved S3
and R3 `cb4a073a7e4ec3dfb53cedb76ea71b070299a1f9` on 2026-08-16 and authorized
the docs-only closeout. Local `main` was fast-forwarded from baseline
`718e50670812ad5da7210bd9f183521328cccf93` to exact R3, and the P0-W05
completion record is `docs/v2/evidence/packages/P0-W05/COMPLETION.md`. Both
failed gate reports and commits
`75914d954cbf78b7bf4695eed2f135ea1bb627ac` and
`d4819528050b42a2dcefea590c106d912fc5e0cf` remain immutable evidence.

No technical blocker is active. The preserved unverified WIP remains on
`pantheon-v2.1.1-programme` at `612a35c8b1d881f638570373d06f99d26bfb280e`.
Remote freshness remains unproved; publishing `main` is a separate
owner-directed action. The deferred R2 temporary-path privacy diagnostic
remains a future hardening item, not a blocker.

The next action is fresh P1 planning in its own session. No provider,
live/commercial or owner-data action is authorized by this closeout.
