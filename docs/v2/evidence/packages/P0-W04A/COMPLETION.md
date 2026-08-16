# P0-W04A Completion Report

**Package:** P0-W04A — Renderer Environment and Gate Corrections
**Status:** complete
**Completed by:** Codex
**Completed:** 2026-08-16T14:40:42+10:00 (Australia/Brisbane)
**Branch/worktree:** `codex/p0-engineering-os` /
`C:\Pantheon-worktrees\P0-engineering-os`
**Baseline B:** `718e50670812ad5da7210bd9f183521328cccf93`
**First candidate S1:** `9ab7748f1a3443535e1f066b1b3d48efc668aedb`
**Failed review R1:** `75914d954cbf78b7bf4695eed2f135ea1bb627ac`
**Authorized planning tip A:** `628382985a896a0130742a6732dfb2ec58fe5662`
**Implementation checkpoint I:**
`b15f0042f513b4539feb3e6cbb93b26e8a1f91fe`
**Preserved unverified WIP:**
`612a35c8b1d881f638570373d06f99d26bfb280e`

The coherent completion/state commit is the commit containing this report. Its
own SHA is intentionally not self-recorded; normal Git history supplies the
new P0-W05 candidate `S2`.

## Governing authority

- The owner-approved Phase 0 Execution Pack, approved identifier `0.2-draft`.
- The owner-approved P0-W04A work package.
- ADR-0001 for normal Git/state continuity, one writer, honest compatibility
  status and the Phase 0 safety boundary.
- ADR-0002 for the repository-derived next-session prompt contract.
- The immutable first failed gate report at R1. It authorized no rewrite; a
  fresh P0-W05 review must create `PHASE-GATE-REVIEW-02.md`.

## Objective and result

P0-W04A closes the two findings from the first independent Phase 0 gate without
changing Pantheon product or business semantics.

- All 35 formatting findings were corrected mechanically.
- The checkout now owns one ignored, reproducible renderer environment at
  `/.venv-renderer/`, one bootstrap command and one validation command.
- Ordinary tests, Doctor, product rendering and approval-pack rendering share
  one exact fail-closed interpreter and package contract.
- The newest reviewed stable candidate set passed Pantheon's deterministic
  artifact, structure, recovery, production and complete ordinary tests.
- P0-B01's existing isolation closure is revalidated. P0-B03 and P0-B04 close.
  Historical P0-B02 remains unchanged.

Implementation checkpoint I contains the implementation, tests, policy, pins,
mechanical corrections and the final active checkpoint. The completion commit
contains only normal completion evidence and state closeout.

## Formatting correction and immutable evidence

The seven hard-break targets are the Master Plan and six templates. Their Git
blobs differ from A only by 30 replacements of terminal two-space hard breaks
with explicit CommonMark `\` hard breaks. The five approved execution copies
P0-W01 through P0-W05 each differ from A only by removal of one surplus final
LF, retaining one terminal newline.

Committed-blob comparison proves exactly `30 + 5` authorized transformations.
Execution-copy bodies remain exact at 103, 83, 64, 88 and 134 lines. Both the
working diff check and `B..I` diff check pass. The original failed report still
has blob `6928a40ea2c1f0af493e728e6a71084d13291089` and is text-identical to R1.
`package-lock.json` remains unchanged at blob
`51278c519207aaf7f679e8abfe3881457b7578ee`.

## Renderer environment contract

- Local discovery derives only
  `/.venv-renderer/Scripts/python.exe` on Windows or
  `/.venv-renderer/bin/python` elsewhere from the repository root.
- Explicit `PANTHEON_PYTHON` and `JARVIS_PYTHON` values must both be present,
  absolute and coherent. Local aliases must identify the canonical entry. The
  sole external exception is the exact `actions/setup-python` entry derived
  from `pythonLocation` for the exact GitHub-hosted workspace.
- Missing, single, relative, conflicting, foreign, non-CPython, wrong-version,
  system-site, user-site, duplicate-metadata or pin-mismatched environments fail
  closed. There is no managed-Python, profile-cache, PATH or bare-command
  fallback.
- Bootstrap parses and authorizes exactly four direct `==` pins before creating
  or deleting anything or making a network request. It accepts one verified
  absolute base CPython 3.13 installation, creates only the anchored local
  target, and invokes that target through isolated `python -m pip`.
- Pip uses the platform null configuration file, explicit public PyPI index,
  disabled input/keyring/version checks, no inherited index credentials and an
  environment-local cache. Failed creation or install removes only the proved
  target. A valid environment is safely reused only when its actual base prefix
  matches the supplied verified base.
- Validation runs every time it is requested. It proves exact executable and
  prefix provenance, imports, exactly one metadata entry per direct root, exact
  versions, full inventory and `pip check`. Fresh validation was retained as a
  deliberate fail-closed tradeoff; there was no measured acceptance-budget
  failure that justified a drift-prone cache.
- Renderer subprocesses use Python isolated mode. Recovery source validation
  requires the bootstrap CLI, its shared module and the exact two npm command
  surfaces. Generated environments and their cache are excluded from Git and
  encrypted source backups.

The explicit base installation was verified at the redacted absolute location
`%LOCALAPPDATA%\Programs\Python\Python313\python.exe`. It is CPython 3.13.3 and
was not modified. The retained repository-local environment is also CPython
3.13.3.

## Dated official candidate review

Review date: 2026-08-16. Sources are official project documentation or PyPI
release metadata. Candidate and final versions are identical because the full
newest stable set passed; no older-version rollback matrix was required.

| Distribution | Official evidence | Candidate/final | Pantheon result |
|---|---|---:|---|
| openpyxl | PyPI marks 3.1.5 as latest, released 2024-06-28, Python >=3.8: https://pypi.org/project/openpyxl/3.1.5/ | 3.1.5 | PASS: exact workbook fields, formulas, dropdowns, sample rows, deterministic recovery and structure checks |
| Pillow | PyPI marks 12.3.0 as latest, released 2026-07-01, Python >=3.10 with CPython 3.13 artifacts: https://pypi.org/project/pillow/12.3.0/ | 12.3.0 | PASS: image/cover generation, deterministic bytes, product bundle and production tests |
| pypdfium2 | PyPI marks 5.13.0 as latest, released 2026-08-13, with a trusted-published Windows x86-64 wheel: https://pypi.org/project/pypdfium2/5.13.0/ | 5.13.0 | PASS: every expected PDF page rasterized and inspection evidence remained source-bound |
| ReportLab | PyPI marks 5.0.0 as latest, released 2026-06-18, Python >=3.9: https://pypi.org/project/reportlab/5.0.0/ | 5.0.0 | PASS: deterministic guide/approval PDFs, structure, recovery and production checks |

Pillow 12.3.0 received explicit security/artifact review. Its release notes
record PDF and font/GD decompression-bomb limits, command-injection and several
memory-safety fixes, plus image-operation performance improvements:
https://pillow.readthedocs.io/en/stable/releasenotes/12.3.0.html. Pantheon does
not execute `WindowsViewer.get_command()` or accept provider-controlled local
render paths; nevertheless, the selected security release passed all image,
cover, PDF, determinism, atomic-staging and credential-persistence checks.

ReportLab 5.0.0 also received explicit security/artifact review. The official
notes state no change to PDF-making behavior while changing remote-image host
defaults from unrestricted to deny-by-default and removing long-deprecated
options: https://docs.reportlab.com/releases/notes/whats-new-50/. Pantheon's
renderers use local files and require no remote-image allowlist. Exact PDF
bytes, pages, approval packs, recovery and product behavior all passed.

## Final environment inventory

Requirements SHA-256:
`f7f726ac93a6ccf6a748bce73fa467b39b9e9cc0940153b291d44c3d85208b77`.

| Distribution | Version | Basis |
|---|---:|---|
| openpyxl | 3.1.5 | exact direct pin |
| Pillow | 12.3.0 | exact direct pin |
| pypdfium2 | 5.13.0 | exact direct pin |
| reportlab | 5.0.0 | exact direct pin |
| charset-normalizer | 3.5.1 | resolver-required transitive |
| et_xmlfile | 2.0.0 | resolver-required transitive |
| pip | 25.0.1 | venv bootstrap tooling |

The final clean `--recreate` run reported `reused: false`; standalone
`renderer:check` passed; the immediate second bootstrap reported
`reused: true`; and `pip check` passed. The ignored environment remains in this
worktree as required.

## Verification

| Check | Result |
|---|---|
| identity, custody and R1/S1 ancestry | PASS at exact clean A before work |
| immutable failed report | PASS before/after; unchanged R1 blob |
| committed formatting fidelity | PASS: exactly 30 hard-break + 5 EOF corrections |
| `git diff --check B..I` | PASS |
| clean bootstrap / standalone check / second-run reuse | PASS / PASS / PASS |
| final focused P0-W04A command, including new environment tests | 57/57 PASS |
| changed encrypted recovery suite | 19/19 PASS |
| production rendering suite | 28/28 PASS |
| `npm.cmd run lint` | PASS; zero warnings |
| aliases before complete ordinary run | both absent |
| complete ordinary suite | 871/871 PASS; zero fail/skip/cancel |
| state consistency after closeout | PASS |
| independent final implementation/state audits | PASS; no actionable finding |

### Complete ordinary-suite result

| Shard | Tests | Result |
|---:|---:|---|
| 1/5 | 19/19 | PASS |
| 2/5 | 137/137 | PASS |
| 3/5 | 244/244 | PASS |
| 4/5 | 308/308 | PASS |
| 5/5 | 163/163 | PASS |
| **Total** | **871/871** | **PASS** |

The quarantined local lifecycle test was excluded and not run. Tests used local
or loopback behavior and disposable roots; no external provider call occurred.

## Paths and scope

Implementation checkpoint I contains 35 authorized paths:

- mechanical formatting: the Master Plan, six templates and P0-W01 through
  P0-W05;
- environment contract: `.gitignore`, `requirements-runtime.txt`,
  `package.json`, `docs/v2/RENDERER_ENVIRONMENT.md`, the renderer CLI and shared
  runtime module;
- narrow integration: config alias handling, ordinary-test wrapper, Doctor,
  approval pack, product-file factory and backup/recovery validation;
- focused tests: renderer environment, exact runtime requirements, wrapper
  isolation, factory hardening, Doctor, backup/recovery, source exclusion,
  credential persistence and W04A/W05 state dependencies; and
- normal active `PROGRESS.json` / `ACTIVE_HANDOFF.md` checkpoint state.

The completion commit adds this report and updates only the three normal state
records. There is no product/business semantic, runtime schema/database, UI,
provider, commercial, owner-data, unrelated dependency, lockfile, browser,
lifecycle, remote Git, integration, local-main or P1 change.

## State, limitations and rollback

- P0-B01 remains closed and is revalidated by the focused isolation checks and
  alias-absent 871/871 ordinary suite.
- P0-B02 remains the historical W04-only disposable-renderer closure; it was
  not edited or repurposed.
- P0-B03 and P0-B04 close on this evidence. P0-W04A is complete and P0-W05 is
  ready, but no P0-W05 review or integration occurred.
- Claude remains honestly `prepared_not_verified`. Remote freshness remains
  unproved.
- Browser/T3/Playwright, local lifecycle, provider/live/commercial, owner-data,
  global/user configuration, push, PR, merge, rebase, integration and P1 were
  not performed.

Rollback means revert the P0-W04A implementation and completion commits and,
only if required, remove the exact validated `/.venv-renderer/` root after
proving its repository anchoring. Retain R1, its failed report and all prior
W01-W04 history. Rollback authorizes no reset or integration.

## Next action

Start a genuinely fresh P0-W05 session from exact completion tip `S2`. Read
this package and evidence, independently review the complete baseline range,
and write only `docs/v2/evidence/phases/P0/PHASE-GATE-REVIEW-02.md` plus its
normal review-state commit. Never overwrite the original failed report. Any
later local-main integration still requires separate owner authorization.
