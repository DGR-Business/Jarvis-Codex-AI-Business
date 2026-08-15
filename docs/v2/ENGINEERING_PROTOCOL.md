# Pantheon v2.1.1 Engineering Protocol

## Purpose

This protocol makes Pantheon development independent of one model's conversation memory. Codex and Claude Code execute the same repository-owned programme.

## Governing hierarchy

The stable Master Plan defines programme constraints. An owner-approved Phase
Execution Pack may explicitly specialize Master execution for that phase. An
approved Work Package is the most-specific implementation contract within its
Pack, but it cannot silently amend or contradict the Pack, relevant ADRs or
non-specialized Master constraints. A material conflict requires an
owner-reviewed amendment.

`ACTIVE_HANDOFF.md` and completion evidence record execution; they do not grant
authority. Only an approved Work Package authorizes implementation.

## Phase 0 specializations

`decisions/ADR-0001-P0-EXECUTION-CONTRACT.md` records the owner-approved P0
specializations: hooks are optional and evidence-based; browser/T3/Playwright
is not applicable because P0 permits no UI change; P1 planning occurs just in
time after verified P0 integration; and Claude continuity remains
`prepared_not_verified` until a real sequential rehearsal proves it.

## Package lifecycle

```text
backlog → ready → in_progress → review → complete
                   ↘ blocked
```

A package starts only from a known baseline and ends only when its acceptance criteria and specified verification pass.

## Default agent allocation

- Codex: primary implementation and architecture work.
- Claude Code: continuity when Codex usage is unavailable, independent review, second implementation attempt where approved.
- Read-only subagents: repository mapping, dependency analysis, provider research, security review, test-impact analysis and visual critique.

Agent allocation never changes the package contract.

## Session lifecycle

- Phase planning: fresh read-only session.
- Work package: fresh implementation session.
- Same-package debugging: continue the current session.
- Cross-model transfer: fresh receiving-agent session in the same worktree.
- Phase gate: fresh independent review session.

See `SESSION_PROTOCOL.md` for exact rules.

## Change discipline

A discovered issue becomes one of:

- within-scope defect;
- recorded blocker;
- new proposed package;
- ADR-backed phase amendment.

Do not hide scope expansion inside a fix.

## Evidence discipline

Completion evidence can include:

- command output;
- test reports;
- interactive browser screenshots or recordings;
- console/network findings;
- provider sandbox receipts;
- contract examples;
- migration/recovery proof;
- commercial evidence.

Evidence paths belong in the Work Package completion report and `PROGRESS.json`.
Verification follows the current Package and Pack; a generic protocol never
adds a full suite, browser check or provider operation that they do not require.

## Provider discipline

Provider discovery determines what should be used. Provider integration implements an approved decision. Runtime routing chooses only among approved active providers.

## Owner role

The owner approves phase packs, material plan amendments, credentials, provider terms/subscriptions, consequential live actions, meaningful spend and phase gates. The owner should not need to resolve implementation details that the package already defines.
