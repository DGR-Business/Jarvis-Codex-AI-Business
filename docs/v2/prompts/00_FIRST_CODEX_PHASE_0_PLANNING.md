# First Codex Prompt: Phase 0 Planning Only

Copy the block below into a **fresh Codex session** opened on the Pantheon repository after installing this kit.

```text
Read AGENTS.md if installed, docs/v2/PANTHEON_V2_MASTER_PLAN.md,
docs/v2/ENGINEERING_PROTOCOL.md, docs/v2/SESSION_PROTOCOL.md,
docs/v2/PROVIDER_DISCOVERY_AND_QUALIFICATION.md,
docs/v2/WINDOWS_REPOSITORY_PATH_MIGRATION.md, docs/v2/PROGRESS.json,
and the current repository.

This is a planning-only Phase 0 session. Do not modify Pantheon production or
business behaviour. Inspect the current repository instructions, Codex and
Claude configuration, skills, hooks, scripts, test runner, CI, build logs,
large modules and current working state.

First verify the active Git root and record whether `C:\Pantheon` is the current
master worktree. Identify linked worktrees and any operational former-path
dependency without printing secrets.

Create a proposed docs/v2/phases/P0-EXECUTION-PACK.md containing 5 to 8 bounded
work packages, exact acceptance criteria, targeted verification commands,
expected artifacts, rollback steps, session boundaries, cross-model handoff
requirements, scope exclusions and stop conditions.

Reconcile the proposed AGENTS.md and CLAUDE.md from the kit with any existing
root instructions, but do not install or modify them in this planning session.
Identify the first recommended work package and explain why it is the safest
starting point.

Use read-only subagents for repository mapping and test-impact analysis when
helpful. Stop after producing the Phase 0 Execution Pack. End with:
PHASE PLAN READY: OWNER REVIEW REQUIRED.
```
