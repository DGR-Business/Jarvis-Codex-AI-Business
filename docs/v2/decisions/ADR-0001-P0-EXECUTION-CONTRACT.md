# ADR-0001: Phase 0 execution-contract specializations

**Status:** approved
**Date:** 2026-08-15
**Owner approval:** recorded in the owner-approved Phase 0 Execution Pack
version `0.2-draft`, sections 3, 6 and 20

## Context

The stable Pantheon v2.1.1 Master Plan describes the programme-wide execution
model. The approved Phase 0 Pack responds to current repository evidence and
needs a narrower P0 execution contract without silently editing or
re-versioning the Master. The Pack's version string retains `draft` as part of
its approved identifier; its recorded status is Approved.

## Decision

1. An owner-approved Phase Execution Pack may explicitly specialize Master Plan
   execution for its phase. An approved Work Package is the most-specific
   implementation contract within that Pack, but cannot silently amend or
   contradict the Pack, relevant ADRs or non-specialized Master constraints. A
   material conflict requires an owner-reviewed amendment.
2. P0-W01 through P0-W04 use the single external
   `codex/p0-engineering-os` lane sequentially, with one writing agent at a
   time. Read-only investigation may run in parallel without mutating the lane.
3. Normal Git commits plus `PROGRESS.json`, `BLOCKERS.md`,
   `ACTIVE_HANDOFF.md` and package completion reports are the P0 continuity
   layer. P0 adds no parallel receipt, attestation, hash or state system.
4. Phase 0 hooks are optional, repository-scoped and evidence-based. A justified
   no-hook result satisfies P0; no hook is installed or claimed by this ADR.
5. Browser/T3/Playwright verification is not applicable to P0 because P0
   permits no material owner-facing UI change. An unexpected UI delta is a
   scope failure.
6. The Phase 1 Execution Pack is planned just in time, in a fresh planning-only
   session after verified P0 integration. P0 does not begin P1 planning.
7. Claude compatibility is labelled `prepared_not_verified` until a real,
   sequential same-worktree rehearsal is completed. Claude unavailability does
   not block unrelated P0 work and cannot be represented as verification.

## Alternatives considered

- Editing or re-versioning the stable Master during P0 was rejected because it
  would hide a phase-specific decision inside the programme baseline.
- Mandatory hooks and P0 browser/T3 work were rejected because current evidence
  does not justify them and P0 contains no UI change.
- Premature P1 planning and simulated Claude verification were rejected because
  both would describe evidence that does not yet exist.

## Consequences

- Active instructions, protocols, prompts and state must use this authority and
  session interpretation consistently.
- The P0 gate may be binary `PASS` or `FAIL` while truthfully recording Claude
  as `prepared_not_verified` when no real rehearsal exists.
- These are P0 execution specializations, not a general silent change to the
  stable Master. General adoption requires a later owner-approved plan revision.
- Git history and the normal progress, blocker, handoff and completion records
  remain the continuity layer; this ADR creates no receipt or hash manifest.

## Evidence

- `docs/v2/phases/P0-EXECUTION-PACK.md`, especially sections 3, 6, 17 and 20.
- `docs/v2/evidence/packages/P0-W01/COMPLETION.md` for the clean-lane baseline
  and limitations inherited by P0-W02.

## Rollback or supersession

Revert the coherent P0-W02 commit before integration, or supersede this ADR
through an owner-approved amendment. Rollback must not restore legacy authority,
claim unsupported hooks/browser/Claude evidence or rewrite the Master silently.
