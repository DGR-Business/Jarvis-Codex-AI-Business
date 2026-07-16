# OpenAI Agents SDK Architecture Review

Date: 2026-07-16
Status: reviewed against current official TypeScript SDK guidance
Maintainer: Codex

## Sources

- [Agents SDK overview](https://openai.github.io/openai-agents-js/)
- [Agent orchestration](https://openai.github.io/openai-agents-js/guides/multi-agent/)
- [Running agents](https://openai.github.io/openai-agents-js/guides/running-agents/)
- [Human-in-the-loop](https://openai.github.io/openai-agents-js/guides/human-in-the-loop/)
- [Tracing](https://openai.github.io/openai-agents-js/guides/tracing/)
- [Guardrails](https://openai.github.io/openai-agents-js/guides/guardrails/)

The official OpenAI Developer Docs MCP service is installed globally in Codex
as `openaiDeveloperDocs`, enabled over `https://developers.openai.com/mcp`.
It is a developer documentation integration, not a business-worker tool. A new
Codex task or app restart is required before its tools appear in a session that
started before installation.

## Overall Finding

The foundation is directionally correct. Jarvis should continue to own business
state, approvals, costs, evidence, audit records, dashboard truth and
deterministic workflow boundaries. The Agents SDK should own specialist model
loops, tools, handoffs, interruptions and provider traces only inside those
boundaries.

The current Demand Validator is appropriately narrow: one agent, one turn,
structured output, no tools, no SDK handoffs and a separate operator judgement.
It would be premature to add sessions, broad tools or multi-agent delegation
before this capability proves useful over distinct fixtures.

## Corrections Completed

1. **Provider trace visibility is now explicit.** The first successful pilot
   used `store: false` and `traceIncludeSensitiveData: false`. That explains why
   the trace existed but the Platform could not fetch its Response or show
   input/output content. The historical Response cannot be recovered.
2. **Future controlled non-personal fixtures can be inspected.** Their approval
   scope now binds `providerResponseStored: true` and
   `providerTraceContent: true`. Other live work retains privacy-first defaults.
3. **Local review no longer depends on the provider dashboard.** The AI Team
   exposes a run review containing evidence, counterevidence, assumptions,
   conclusion, proposed test, metric, stop rule, risks, quality checks, tokens,
   cost, IDs and local trace events. Full structured output remains available to
   Codex through the focused local API.
4. **Approval hashing accepts both stored JSON and hydrated runtime objects.**
   Trace policy is part of the single-use scope and cannot change silently.
5. **Operator startup is independent of Codex.** `START JARVIS.cmd` starts the
   runtime and scheduler in protected mode, verifies health and opens the
   dashboard. `STOP JARVIS.cmd` stops only its recorded process.

## What To Keep

- Code-driven orchestration for speed, cost predictability and clear failure
  handling. Official guidance specifically identifies these advantages.
- Structured outputs as the contract between an SDK worker and the business
  runtime.
- Capability-specific promotion after reviewed evidence, not global agent
  autonomy.
- Runtime approval and cost rails around every live call.
- Human commercial usefulness as a separate gate from technical correctness.
- One venture and one test at a time until revenue evidence exists.

## Recommended Next Additions

### Now

1. Daniel reviews the existing run in the local AI Team drawer before recording
   any usefulness verdict.
2. If the result is useful, run one distinct supplied-evidence fixture with the
   new provider trace policy and verify both the local review and OpenAI trace.
3. Keep the second fixture to one turn, no tools and the same A$1 cap.

### When Read-Only Tools Begin

1. Add one bounded web-search tool to Demand Validator under its own A$2 scope.
2. Use an SDK tool input guardrail for allowed query purpose and an output
   guardrail for citation/provenance requirements.
3. Bridge SDK `interruptions` and serialized `RunState` into the existing Jarvis
   approval records so a paused tool call resumes rather than restarts.
4. Add a local trace processor only when tools or handoffs create events that
   the current runtime trace cannot reconstruct reliably.

### When Multiple Workers Are Proven

Use Chief of Staff as the manager and expose specialists as bounded agent tools
when one final operator recommendation must combine their work. Official
guidance prefers the manager pattern when one agent should retain control of the
final answer and shared guardrails. Use SDK handoffs only when a specialist
genuinely needs to own the remainder of a turn.

## Deliberately Deferred

- SDK sessions or long-term model memory for one-turn workers.
- Autonomous loops that critique and retry without a fixed cap.
- Broad MCP, filesystem, browser or account access for business workers.
- Model-based usefulness grading before Daniel establishes the human standard.
- A second live worker before Demand Validator produces reviewed repeatable
  value.

## Review Trigger

Review this architecture after the first search-enabled Demand Validator run or
before introducing any SDK tool that can publish, contact a customer, change an
account, spend money or create a legal/compliance effect.
