# P0-W04B Completion Report

**Package:** P0-W04B — Exact Renderer Inventory Corrective Package
**Status:** complete
**Completed by:** Codex
**Completed:** 2026-08-16T17:01:22+10:00 (Australia/Brisbane)
**Branch/worktree:** `codex/p0-engineering-os` /
`C:\Pantheon-worktrees\P0-engineering-os`
**Baseline B:** `718e50670812ad5da7210bd9f183521328cccf93`
**Reviewed candidate S2:** `e37c958a232e139f6216caae66b5b7932b6a6e0b`
**Second failed review R2:**
`d4819528050b42a2dcefea590c106d912fc5e0cf`
**Authorization/state checkpoint A2:**
`9050e59fb28289c841983b5cda69e2e87db110ac`
**Implementation checkpoint I2:**
`f0ee7662cc4e6ccb5f81fa0f000998964b740221`
**Preserved unverified WIP:**
`612a35c8b1d881f638570373d06f99d26bfb280e`

The coherent completion/state commit is the commit containing this report. Its
own SHA is intentionally not self-recorded; normal Git history supplies the
new P0-W05 review-03 candidate `S3`.

## Governing authority and result

The owner-approved P0-W04B Phase Pack amendment and focused work package
specialize the earlier P0-W04A renderer contract only for the complete
installed inventory, governed pip tooling, review number and later integration
reprovisioning. They preserve the Master Plan, the remainder of P0-W04A, both
failed gate reports and all completed package history.

P0-W04B corrects only `P0-GATE-02-F01`:

- `requirements-runtime.txt` remains the byte-identical four-root contract;
- one tracked `requirements-renderer-lock.txt` governs the exact complete
  seven-distribution inventory;
- bootstrap installs only that inventory and validation rejects every extra,
  missing, changed or duplicate-normalized metadata record;
- safe reuse requires the same exact inventory and verified base provenance;
- hosted setup-python is bootstrap provenance only, while ordinary hosted
  execution uses the checkout-local environment; and
- Doctor, ordinary tests, product/approval rendering and recovery continue to
  share the canonical fail-closed resolver.

P0-B04 closes on I2 plus the verification below. P0-W05 is ready only for a
fresh independent review 03; no gate review, integration or P1 work occurred.

## Immutable evidence and commits

- A2 has exact parent R2 and records the bounded package, Phase Pack
  specialization, reopened blocker and W04A -> W04B -> W05 dependency state.
- I2 has exact parent A2 and contains the single lock contract, implementation,
  policy/CI/Doctor/recovery changes, directly affected fixture helpers and
  focused regressions.
- S3 contains only this completion report and the three normal state records.
- The original gate report remains blob
  `6928a40ea2c1f0af493e728e6a71084d13291089`.
- The second gate report remains blob
  `d5bf6cddde6093126f7fb008d7f112bc214f7eb5`.
- `package-lock.json` remains blob
  `51278c519207aaf7f679e8abfe3881457b7578ee`.
- `requirements-runtime.txt`, renderer Python algorithms, approval/product
  business code and product byte contracts remain unchanged.

## Exact renderer inventory and constraints

Root requirements SHA-256:
`f7f726ac93a6ccf6a748bce73fa467b39b9e9cc0940153b291d44c3d85208b77`.

Full-inventory lock SHA-256:
`e89141b3031ce59ee3ce9560378efb7ee6b2dd20b2cd5e95592822565994bd53`.

| Normalized distribution | Version | Basis |
|---|---:|---|
| openpyxl | 3.1.5 | exact direct runtime root |
| pillow | 12.3.0 | exact direct runtime root |
| pypdfium2 | 5.13.0 | exact direct runtime root |
| reportlab | 5.0.0 | exact direct runtime root |
| charset-normalizer | 3.5.1 | exact governed transitive |
| et-xmlfile | 2.0.0 | exact governed transitive |
| pip | 26.2.1 | exact governed bootstrap tooling |

The lock parser normalizes distribution names, requires exactly seven unique
pins and proves that all four roots match `requirements-runtime.txt`. The
installed metadata inventory must contain exactly one normalized record for
each row and nothing else. Validation also proves required imports, CPython
3.13, canonical executable/prefix, venv and base-prefix provenance, disabled
system/user site access and a passing `pip check`.

Bootstrap uses isolated `python -m pip` with the explicit public PyPI index,
null pip configuration, inherited indexes/credentials suppressed, an
environment-local cache, `--no-deps`, `--only-binary=:all:` and the exact lock
as the install list. No dependency resolver expansion, source build or package
outside the seven approved releases is authorized.

## Interpreter and bootstrap provenance

The verified base is the existing redacted
`%LOCALAPPDATA%\Programs\Python\Python313\python.exe`: CPython 3.13.3, not a
virtual environment, with coherent executable, prefix and base prefix. It was
not modified. The retained canonical runtime is
`/.venv-renderer/Scripts/python.exe`, also CPython 3.13.3, and its actual base
prefix matches that verified base.

Immediately before recreation, the target was re-proved as the exact anchored
ordinary directory `C:\Pantheon-worktrees\P0-engineering-os\.venv-renderer`
with no link type. The clean `--recreate` bootstrap reported `reused=false`,
the standalone check and `pip check` passed, and an immediate second bootstrap
reported `reused=true` with the same exact inventory and provenance.

## Recovery, CI and shared resolution

- Recovery-source validation now requires the tracked full-inventory lock.
  Source backups retain that lock and continue to exclude generated
  `/.venv-renderer/` files and cache contents.
- Every directly affected bootable-source fixture copies the lock, and missing
  lock recovery fails closed.
- Hosted CI hashes both contracts, uses setup-python only as the verified
  bootstrap base, recreates and checks the checkout-local environment, and
  runs ordinary tests through that canonical runtime rather than setup-python.
- Doctor reports both contract hashes and structured full-inventory failures.
  Product rendering, approval-pack rendering and ordinary tests retain the
  unchanged shared resolver boundary.

## Required verification

| Command/check | Result |
|---|---|
| exact anchored `renderer:bootstrap --recreate` from verified CPython 3.13.3 | PASS; `reused=false`; exact seven-item inventory |
| `npm.cmd run renderer:check` | PASS; imports, provenance, full inventory and `pip check` |
| immediate second `renderer:bootstrap` | PASS; `reused=true` |
| required focused renderer/isolation/Doctor/product/refresh/startup/status command | 61/61 PASS |
| `npm.cmd test -- test/pantheon-backup-recovery-set.test.js` | 19/19 PASS |
| `npm.cmd test -- test/pantheon-production.test.js` | 28/28 PASS |
| `npm.cmd run lint` | PASS; zero lint errors |
| both renderer aliases before ordinary run | absent in the ordinary test process |
| complete `npm.cmd test` | 875/875 PASS; zero fail/skip/cancel |
| `node scripts/v2/status.js --check` | PASS before and after closeout |
| working and complete `B..HEAD` `git diff --check` | PASS |
| `git diff --name-status R2..HEAD` and final custody checks | PASS; authorized package range only |
| independent history/custody, implementation and state audits | PASS; no actionable finding |

### Complete ordinary-suite result

| Shard | Tests | Result |
|---:|---:|---|
| 1/5 | 19/19 | PASS |
| 2/5 | 167/167 | PASS |
| 3/5 | 236/236 | PASS |
| 4/5 | 292/292 | PASS |
| 5/5 | 161/161 | PASS |
| **Total** | **875/875** | **PASS** |

The quarantined local Windows lifecycle test remained excluded and was not
run. Tests used local or loopback behavior and disposable roots; no external
provider call occurred.

## Scope, limitations and rollback

- P0-B01 remains closed and is revalidated by the isolation coverage and the
  alias-absent 875/875 ordinary suite. P0-B02 and P0-B03 history is preserved.
- The separate R2 diagnostic temporary-path limitation remains deferred. The
  ordinary suite reproduced its retained-PDF temporary-path diagnostic line;
  this package neither concealed nor changed that behavior.
- The ignored `/.venv-renderer/` remains only in this implementation checkout.
  Any later separately authorized integration must provision and validate the
  same exact inventory in its own checkout; virtual-environment files are not
  copied.
- Claude continuity remains honestly `prepared_not_verified`; no unavailable
  Claude CLI rehearsal was simulated. Remote freshness remains unproved.
- Browser/T3/Playwright, the local lifecycle test, providers/live models,
  commercial or owner-data actions, global/user configuration, remote Git,
  merge/rebase/integration, the third gate review and P1 were not performed.

Rollback is by reviewed normal revert of S3, I2 and A2 while retaining R1, R2,
their reports and all earlier package history. If environment removal is also
required, first re-prove the exact checkout-local ordinary non-linked
`/.venv-renderer/` target. Rollback authorizes no reset, history rewrite or
integration.

## Next action

Start a genuinely fresh P0-W05 review-03 session from exact completion tip
`S3`. Re-prove custody and immutable report blobs, read the governing package
and completion evidence, independently review the complete `B..S3` range, and
write only `docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW-03.md` plus its normal
review-state commit. Preserve reviews 01 and 02. Do not integrate or start P1
without separate owner authorization.
