# ADR-0002: Next-session copy/paste prompt contract

**Status:** approved
**Date:** 2026-08-16
**Owner approval:** explicit owner directive issued for P0-W04 and captured by
this repository decision

## Context

The normal Pantheon continuity layer records programme state in Git plus the
progress, blocker, handoff and package-evidence files. An outgoing agent could
still leave the owner to reconstruct the next invocation from those records,
or mechanically point at the next numbered package even when a blocker or gate
made that package unready.

During P0-W04 the owner expressly required one concise, shared completion rule:
every repository-governed Pantheon session must finish with a ready-to-paste
prompt for the actual next action, generated only after final verification and
state updates. This includes package execution, continuation, model handoff,
blocker/owner action, gates, approvals, planning and amendments. The directive
applies equally to Codex and Claude Code. Recording it here makes that additive
owner authority durable without editing the approved Pack or the verbatim W04
execution copy.

## Decision

1. `AGENTS.md` owns the shared concise rule and `CLAUDE.md` inherits it through
   its existing import. No second model-specific version is maintained.
2. After final verification and required state/evidence updates, the outgoing
   response must contain `NEXT SESSION — COPY/PASTE PROMPT` immediately before
   the exact terminal outcome.
3. The prompt must be derived from the actual repository state. Where relevant
   it includes the next session or package, objective, lane, first Git checks,
   governing evidence, inherited blockers and decisions, scope boundaries,
   targeted verification, model-handoff duties, mutation restrictions and the
   required terminal outcome.
4. The prompt must name the correct continuation, owner action, cross-model
   handoff, gate, approval, planning or amendment when that is the next action.
   It must not blindly select the next numbered package.
5. This is an instruction/protocol rule only. It creates no prompt generator,
   hook, daemon, database, writer, receipt system or orchestration subsystem,
   and does not change package readiness or grant product/provider authority.
   The exact terminal outcomes already defined by `AGENTS.md` remain unchanged.

## Alternatives considered

- Leaving the directive only in one conversation was rejected because a fresh
  repository-only session could not discover it.
- Duplicating the rule in Claude-specific instructions was rejected because it
  would create drift from the shared contract.
- A generator or mandatory Stop hook was rejected because output correctness
  depends on final repository truth and judgment, not the presence of a text
  heading, and P0-W04 authorizes no continuity subsystem.

## Consequences

- Future package sessions end with a usable owner handoff matched to the real
  terminal state, including blocked or approval-required states.
- `PROGRESS.json`, `BLOCKERS.md`, `ACTIVE_HANDOFF.md`, evidence and Git remain
  authoritative for state; the generated prompt reports that state and does
  not create authority.
- P0-W04 can implement the owner-directed rule as part of its continuity work
  without expanding `scripts/v2/status.js` or changing product semantics.

## Evidence

- `AGENTS.md`, section `Next-session copy/paste prompt`.
- `docs/v2/evidence/packages/P0-W04/CHECKPOINT.md`.
- `docs/v2/ACTIVE_HANDOFF.md`.

## Rollback or supersession

Before integration, revert the coherent P0-W04 prompt-contract changes only on
owner direction. After integration, supersede this decision through a recorded
owner-approved protocol amendment. Rollback must not leave model-specific
instructions claiming a rule that the shared contract no longer contains.
