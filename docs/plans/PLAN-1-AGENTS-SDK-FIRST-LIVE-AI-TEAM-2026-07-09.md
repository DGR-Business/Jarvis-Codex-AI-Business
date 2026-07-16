# Plan 1 - Agents SDK First Live AI Team

Date: 2026-07-09
Status: facade implemented; first real provider pilot still gated
Owner: Operator
Maintainer: Codex

## Summary

Jarvis-Codex will plan the AI Team around the OpenAI Agents SDK as the
first-class live worker execution path. Existing OpenAI Responses API research
and worker adapter work stays in place as useful lower-level infrastructure,
but it no longer defines the long-term worker orchestration strategy.

The Jarvis runtime remains the business operating system. It owns state,
approvals, cost limits, logs, trace persistence, evals, dashboard state,
business rules, retries, failure handling, and operator decisions. The Agents
SDK manages the live agent loop for specialist workers once a run is approved.

## Direction Change

Supersede the earlier 2026-07-07 decision to use the Responses API as the first
live worker execution path.

New direction:

- OpenAI Agents SDK is the intended first-class live AI Team runner.
- Responses API remains a low-level provider path for direct model calls,
  research/search adapters, and fallback cases where direct runtime control is
  better.
- Existing Responses implementation is preserved as infrastructure and
  historical proof, not deleted.
- No live spend, publishing, customer contact, account action, legal/compliance
  decision, or money movement can occur without explicit approval and runtime
  readiness.

## Implementation Target

Runtime implementation now introduces an internal `AgentRuntime` facade:

- The business runtime calls `AgentRuntime`, not SDK/provider code directly.
- `AgentRuntime` applies Jarvis approval, budget, task, trace, eval, and
  dashboard rules before and after a live run.
- The primary live worker runner inside the facade is the OpenAI Agents SDK.
- Responses API remains available for direct provider calls, research/search,
  and fallback paths.
- The facade starts narrow with Demand Validator before any broad AI Team live
  execution is widened.

## First Pilot

The first live AI Team pilot is:

- Worker: Demand Validator.
- Scope: one capped, approval-gated business validation task.
- Output: structured business decision contract that can be compared against
  protected baseline output.
- Controls: cost cap, no external tools unless separately approved, trace/eval
  record, provider failure no-spend evidence, dashboard decision visibility.
- Hard stops: no publishing, no customer contact, no account actions, no
  legal/compliance decisions, and no money movement.

Implementation state:

- The facade, SDK readiness surface, capped live-worker request path, approval
  provider requirement, model-call record, cost record, trace/eval record, and
  provider-failure no-spend path are implemented and stub-tested locally.
- The first real provider-backed run remains locked until the operator
  deliberately configures credentials, enables the live-model flag, approves the
  cost-capped run, and reviews trace/eval/cost evidence afterward.

## Documentation Work In This Plan

- Update the master plan so Agents SDK is the primary live AI Team path.
- Update the build log with a 2026-07-09 decision and correction journal entry.
- Add Decision 0004 for the architecture choice.
- Save Plan 2 for cockpit simplification and scoped AI testing after the
  Agents SDK direction is locked.
- Verify stale unsuperseded wording is removed or marked as historical.

## Verification

Documentation verification:

- Search for stale unsuperseded wording:
  - "Responses API remains the right first live path"
  - "Do not migrate fully to Agents SDK yet"
  - "Use the Responses API as the first live worker execution path"
- Any remaining references to the old Responses-first decision must be marked as
  historical or superseded.

Runtime verification after facade implementation:

- Focused live-worker tests passed for readiness, approval gate, SDK success,
  SDK provider failure with no-spend evidence, and HTTP smoke-test preparation.
- `npm.cmd test` passed 62/62 tests.
- The first real provider-backed run is still intentionally blocked until
  credentials, live-model flag, explicit approval, budget room, trace/eval
  review, and billing reconciliation are in place.
