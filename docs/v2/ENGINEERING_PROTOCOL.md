# Pantheon v2.1.1 Engineering Protocol

## Purpose

This protocol makes Pantheon development independent of one model's conversation memory. Codex and Claude Code execute the same repository-owned programme.

## Work hierarchy

1. Master Plan
2. Phase Execution Pack
3. Work Package
4. Active Handoff
5. Completion evidence

Only an approved Work Package authorizes implementation.

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

## Provider discipline

Provider discovery determines what should be used. Provider integration implements an approved decision. Runtime routing chooses only among approved active providers.

## Owner role

The owner approves phase packs, material plan amendments, credentials, provider terms/subscriptions, consequential live actions, meaningful spend and phase gates. The owner should not need to resolve implementation details that the package already defines.
