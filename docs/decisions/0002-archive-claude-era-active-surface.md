# Decision 0002 - Archive Claude-Era Active Surface

Date: 2026-07-06

## Decision

Move Claude-era agents, hooks, dashboards, procedures, audits, local tool state,
and handover files out of the active workspace and into `archive/historical/`.

## Context

This repository is now the Codex home for the business runtime. The old files
are useful context, but many of them describe Claude Code, old paths, old remote
control assumptions, and old publish flows. Leaving them active makes future
sessions more likely to follow stale instructions.

## Consequences

- Active instructions now come from `AGENTS.md`, current `docs/`, and current
  `config/`.
- Archived files can still be searched for history.
- Any useful legacy idea must be deliberately migrated into current runtime docs
  or code before it becomes active again.

## Review Trigger

Review if a legacy workflow is intentionally revived.
