# P0-W04-A01 — Disposable exact-renderer verification amendment

**Status:** approved
**Approved:** 2026-08-16
**Owner approval:** Daniel expressly approved this narrow P0-W04 amendment
**Applies to:** P0-W04 only

## Context

P0-W04 repaired the ordinary-test isolation defect and passed its bounded
focused checks. Its required complete ordinary suite remained blocked because
neither pre-existing Python interpreter matched every exact version in
`requirements-runtime.txt`. The approved W04 copy otherwise prohibited tool
installation, so the renderer precondition could not be resolved without an
owner-reviewed amendment.

## Amendment

For the sole purpose of completing P0-W04 verification, one writing agent may:

1. create one disposable Python renderer environment outside the repository;
2. install into that environment only the exact packages already specified by
   `requirements-runtime.txt`;
3. use narrowly necessary package-index access to obtain those exact packages;
4. validate the resulting interpreter and package versions;
5. set `PANTHEON_PYTHON` and `JARVIS_PYTHON` to that same validated absolute
   interpreter for P0-W04 verification commands; and
6. remove the disposable environment after verification evidence is captured.

This authority specializes only P0-W04 acceptance criterion 8 and its renderer
stop condition. It does not change any dependency pin, production or business
semantics, source/runtime contract, global or user configuration, provider or
commercial authority, package readiness rule, or later-package scope. It does
not permit mutation of either existing interpreter.

## Required verification and closure

- Run the focused environment-isolation tests.
- Run `npm.cmd run lint`.
- Run one complete ordinary `npm.cmd test` with both aliases set to the exact
  disposable interpreter. Do not run the quarantined Windows lifecycle test.
- Run `node scripts/v2/status.js --check` and `git diff --check` after final
  state/evidence updates.
- Close P0-B01 and P0-B02, create P0-W04 `COMPLETION.md`, and mark W04 complete
  only if the complete ordinary suite and all other acceptance criteria pass.
- Otherwise preserve truthful failure evidence and keep P0-W04 blocked.

P0-W05 must not begin in this session, including after a green W04 result.

## Rollback

Remove the disposable environment and revert this amendment checkpoint before
integration if owner approval is withdrawn. Do not revert valid W04 isolation
work, mutate the existing interpreters, or change repository pins as rollback.
