# Active Handoff

**Package:** P0-W04B
**Status:** in_progress
**Current writing agent:** Codex
**Worktree/branch:** `C:\Pantheon-worktrees\P0-engineering-os` / `codex/p0-engineering-os`
**Updated:** 2026-08-16T16:10:59+10:00

## Objective and current checkpoint

Correct only `P0-GATE-02-F01` by making the isolated checkout-local renderer
fail closed against complete installed-distribution drift. The owner-approved
Phase Pack specialization and focused P0-W04B contract are being recorded in
the first normal package commit, `A2`, whose parent must be exact R2.

No renderer implementation or verification result is claimed at this
checkpoint. P0-B04 is truthfully reopened and P0-W05 remains backlog.

## Proven immutable anchors

- baseline/local `main` (`B`):
  `718e50670812ad5da7210bd9f183521328cccf93`;
- preserved clean WIP:
  `612a35c8b1d881f638570373d06f99d26bfb280e`;
- reviewed candidate (`S2`):
  `e37c958a232e139f6216caae66b5b7932b6a6e0b`;
- second failed review and A2 parent (`R2`):
  `d4819528050b42a2dcefea590c106d912fc5e0cf`;
- original review blob:
  `6928a40ea2c1f0af493e728e6a71084d13291089`; and
- second review blob:
  `d5bf6cddde6093126f7fb008d7f112bc214f7eb5`.

Both registered worktrees were clean at package start, local `main` remained B,
R2's parent was exact S2, the canonical ignored `/.venv-renderer/` was a regular
checkout-local directory, and both Python aliases were absent.

## Exact package contract

`requirements-runtime.txt` stays limited to four direct roots. One small
tracked full-inventory contract may govern exactly:

- openpyxl 3.1.5;
- Pillow 12.3.0;
- pypdfium2 5.13.0;
- reportlab 5.0.0;
- charset-normalizer 3.5.1;
- et_xmlfile 2.0.0; and
- pip 26.2.1.

Validation and reuse must reject every extra, missing, duplicate-normalized or
version-drifted distribution as well as foreign interpreters, base mismatch,
system/user-site exposure, failed imports or failed `pip check`. Hosted
setup-python is a bootstrap base only; CI and ordinary tests use the validated
checkout-local environment. Recovery source validation includes the tracked
contract and backup continues to exclude the generated environment.

## Boundaries

Preserve renderer algorithms, product bytes and business behavior, approval and
product shared resolution, database/runtime schema, UI, providers, package-lock,
both failed reports and the historical W04A/P0-W05 records. Do not absorb the
separate diagnostic temporary-path limitation. Browser/T3/Playwright, local
lifecycle, provider/live/commercial/owner-data actions, remote Git, integration,
the third gate review and P1 remain forbidden.

## Exact next action

After committing A2, implement the exact inventory contract and focused tests
only. Commit that coherent implementation as I2, run the complete authorized
verification ladder, then write truthful completion evidence/state as S3 or
stop with P0-B04 open on any failure.
