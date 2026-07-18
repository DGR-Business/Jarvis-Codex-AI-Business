# Decision 0001 - Master Plan Is Source of Truth

Date: 2026-07-05

## Decision

Use `docs/Pantheon Master Plan.md` as the living steering document for the
Pantheon build. The earlier filename is historical.

## Context

The project is broad: runtime, agents, dashboard, approvals, deliverables,
finance, integrations, monitoring, and commercial venture execution. Without a
short maintained plan, the build can drift toward demos or isolated features
that do not move the business operating system forward.

## Consequences

- Each significant continuation should check the master plan before choosing
  the next work item.
- New build work should map to a stage, system layer, and backlog item.
- When testing changes reality, the plan should be updated rather than ignored.
- Detailed technical notes can live in `docs/plans/` or `docs/architecture/`,
  but the master plan stays the high-level source of truth.

## Review Trigger

Review this decision when the runtime reaches Stage 4 commercial venture launch
or if the master plan becomes too large to stay useful.
