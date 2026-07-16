# Decision 0004 - Agents SDK First Live AI Team

Date: 2026-07-09

## Decision

Use the OpenAI Agents SDK as the primary path for live AI Team execution.

The Jarvis runtime will expose an internal `AgentRuntime` facade. The business
runtime keeps ownership of approvals, cost limits, state, logs, trace
persistence, evals, dashboard state, business rules, and hard-stop decisions.
The Agents SDK is the first-class runner for specialist live workers once a run
is approved.

## Context

The destination is a specialist AI business team doing real commercial work
under human approval. The system needs workers with narrow instructions, tool
scopes, handoffs, guardrails, traces, resumable approvals, eval checks, and
plain-language operator decisions.

Existing Responses API work is valuable infrastructure. It already supports
live research/search and direct model-call paths behind approval gates. However,
using Responses as the main worker orchestration layer would make Jarvis build
more custom loop, handoff, tracing, and approval machinery than necessary.

## Options Considered

1. Responses-first

   Keep using direct Responses calls for the first live worker path and migrate
   to Agents SDK later.

2. Agents-SDK-first

   Build a thin runtime facade and use the Agents SDK as the live worker runner
   from the first capped AI Team pilot.

3. Custom orchestration only

   Continue building all agent loops, handoffs, tracing, and approvals directly
   in the Jarvis runtime without a first-class agent SDK.

## Consequences

- Build a thin `AgentRuntime` abstraction before widening live worker
  execution.
- Start with Demand Validator as the first capped Agents SDK pilot.
- Preserve existing approvals, cost controls, traces, evals, result records,
  dashboard state, and hard-stop rules.
- Keep Responses API available for direct model calls, research/search
  adapters, and fallback cases where direct control is better.
- Do not delete historical Responses worker work; mark the old Responses-first
  decision as superseded.
- Avoid overbuilding a custom agent orchestration framework before testing one
  narrow live worker.

## Review Trigger

Review this decision after the first capped Demand Validator Agents SDK pilot
has completed and the operator has reviewed the trace, eval result, cost,
usefulness, and control evidence.
