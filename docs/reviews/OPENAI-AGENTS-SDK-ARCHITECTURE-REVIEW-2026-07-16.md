# OpenAI Agents SDK Architecture Review

Date: 2026-07-16
Status: historical review; incorporated into the 2026-07-18 Pantheon release
Maintainer: Jarvis (Codex)

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

The foundation is directionally correct. Pantheon should continue to own business
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
5. **Operator startup is independent of Codex.** `START PANTHEON.cmd` starts the
   runtime and scheduler in protected mode, verifies health and opens the
   dashboard. `STOP PANTHEON.cmd` stops only its recorded process.

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

## Additions Implemented On 2026-07-16

The documentation review was converted into executable runtime controls without
widening live authority:

1. Every worker now receives an allowlisted, versioned model packet and a strict
   role-specific output schema. Complete task records, raw metadata and local
   paths are not sent as generic model context.
2. One capability bridge maps exact Jarvis tool IDs to Agents SDK hosted tools.
   Demand Validator receives only capped web search; Product Builder receives
   only capped image generation; Quality Reviewer receives exact approved local
   images as bounded multimodal model input but no generation permission. Asset
   IDs must belong to the same workflow; local records retain hashes and limits,
   not image data or file paths.
3. The SDK runner binds tool count, turn count, deadline, storage, trace-content
   policy, arguments, model and cost cap to the single-use approval scope.
4. Provider activity, sources, queries, generated-asset hashes, response IDs,
   SDK trace IDs, token estimates and pending hosted-tool charges are recorded
   locally without retaining image base64 or claiming estimates as invoices.
5. SDK interruptions are serialized into Jarvis approval records. Approval
   resumes the same hash-verified run state; rejection or requested changes stop
   it. The scheduler cannot silently restart the call.
6. Agent-facing structured data and operator-facing decision briefs are now
   separate products. The latter exclude raw paths and machine records.

All capability flags are off in protected operation. No search, image, vision,
publishing, customer-contact or account action was performed for this work.

## Recommended Next Additions

### Now

1. The first result is technically passed and Daniel rated it useful at 4/5;
   keep the exact capability supervised at its current 1/5 streak.
2. Decide the separate business handoff on whether the recommendation should
   advance to a small, non-paid interest test.
3. If the path continues, use one distinct supplied-evidence fixture with the
   new provider trace policy. Keep it to one turn, no tools and the same A$1 cap.

### When The First Read-Only Tool Is Tested

1. Use the implemented web-search bridge only under a fresh A$2 approval, three
   call maximum and 120-second deadline.
2. Review query purpose, source provenance, unsupported claims, exact tool
   activity and provider cost before accepting the run.
3. Prove the implemented interruption/resume path against the live SDK before
   any autonomy promotion; the deterministic test is already green.
4. Add a local trace processor only if a real tool or handoff event cannot be
   reconstructed from the records now captured.

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
