# Codex Runtime Architecture - 2026-07-04

## Verdict

The new system is a Codex-led runtime, not a Claude prompt workspace. Codex is
the engineer and administrator. The runtime underneath is normal software with
state, approvals, event logs, cost controls, retry semantics, and integration
adapters.

This first implementation proves the operating model without spending money or
creating live marketplace changes.

## Operator Requirements Captured

- The operator never wants to touch code or manually operate routine business
  processes.
- Dashboard first: clean, accessible, powerful, and readable in one screen where
  possible.
- Urgent approval/escalation should eventually reach email and optional Slack or
  ClickUp, while the dashboard remains the source of truth.
- Pilot budget is about A$200-300/month, only when commercial upside is clear.
- First business workflow is market research, commercial/finance consideration,
  digital-product creation, approval, and publish planning.
- Autopilot should require roughly 80-90 percent approval quality before
  promotion.
- Accounting should be Xero-friendly if integration is seamless.
- Old Claude-era files are archived under `archive/historical/` as context, not
  the runtime contract.
- Operator-facing outputs must be named and written for humans, for example
  `POD - Car Shirt Design Mockup Direction Pack (to be approved)`, not raw
  timestamp/build-artifact names.

## Implemented Stack

- Node.js server in `src/server.js`.
- SQLite durable state in `data/runtime.sqlite`, generated locally and ignored by
  Git.
- Runtime schema in `src/db.js` for settings, ventures, workflows, tasks,
  approvals, commands, deliverables, events, costs, revenue, messages, and
  integrations.
- Orchestrator in `src/runtime/orchestrator.js` with blocked, queued, planned,
  running, completed, retry, and failed states.
- Command planner in `src/runtime/planner.js` that turns plain operator
  instructions into planned workflows, staged agent tasks, and named
  deliverables.
- Dry-run agent runner in `src/runtime/agent-runner.js` with model policy, tool
  policy, cost ceilings, deliverable updates, QC handoff, and zero live spend.
- Approval engine in `src/runtime/approvals.js`.
- Dashboard state projection in `src/runtime/state.js`.
- Dry-run digital-product adapter in `src/adapters/digital-products.js`.
- Dry-run Gelato adapter in `src/adapters/gelato.js`.
- Integration health registry in `src/adapters/registry.js`.
- One-screen operator dashboard in `public/`.
- Tests in `test/runtime.test.js`.

## Why This Stack

SQLite and a local Node server are enough to prove the business runtime without
paying for cloud infrastructure or creating credential risk. The data model is
portable: if volume or reliability requirements outgrow local SQLite, the same
entities can move to Postgres plus a worker queue.

The dashboard is deliberately not a marketing page. It is a fixed app shell with
tabs, a health strip, an approval inbox, workflow and task ledgers, finance
guardrails, integration status, an event timeline, and an inspector. The main
page does not scroll on desktop; dense records scroll inside their own bounded
panels only when required.

## Operator Deliverables

Anything created for the operator to read or approve should be registered as a
deliverable with a human-friendly name, audience, format, status, file path, and
plain-English purpose. Runtime-only working material can stay in Markdown, JSON,
SQLite rows, or logs. Big decisions should become polished PDF-backed approval
packs once the PDF generator is implemented.

The current planner creates Markdown shells and the dry-run agent runner appends
traceable task output. Those outputs are useful as process proof, but commercial
go/no-go decisions still require live research adapters and real supplier/platform
pricing.

## Agent Runner

The first agent runner is deliberately dry-run. It executes planned internal
tasks one safe step at a time, records model class rather than calling a paid
model, blocks external tools, keeps actual cost at zero, writes task results,
updates deliverables, and marks the workflow `ready_for_review` only after QC.

This proves orchestration, accountability, and output handling before paid model
calls, browser actions, supplier APIs, or marketplace publishing are enabled.

## Autonomy Model

Stage 1 remains proving mode.

- Allowed: research, analysis, internal drafts, dry-run executions, runtime
  maintenance, tests, dashboard updates.
- Approval required: publishing, external visibility, spend, live account action,
  and any workflow with meaningful business risk.
- Hard stops: moving money, legal agreements, account creation, supplier
  contracts, customer disputes, compliance determinations, and direct live
  marketplace changes without a proven adapter.

Promotion toward autopilot is backed by runtime data, not vibes:

- Minimum decided approvals: 20.
- Target first-pass approval rate: 90 percent by default.
- Promotion remains an explicit operator decision.

## Current Proof Workflow

Workflow: digital-product pilot, next opportunity to be selected after the
cleaned Codex home is verified.

Venture: first digital-product pilot.

Purpose: prove the lower-fulfilment commercial path before returning to
POD/Gelato supplier-push automation.

Sequence:

1. Market research gate gathers evidence.
2. Unit economics and channel gate confirms the product can be tested cheaply.
3. Quality and IP gate screens the product family.
4. Approval pack asks the operator to approve, revise, or kill.
5. Any live research, paid asset generation, or publishing action stays blocked
   until explicitly approved.

POD/Gelato adapters remain useful later, but they are no longer the immediate
commercial pilot path.

## Upgrade Path

### OpenAI / Codex

Official Codex docs reviewed on 2026-07-04 described these as separate
surfaces:

- Codex automations can run scheduled work, with project-scoped runs requiring
  the local Codex app and project to be available.
- Codex MCP connects Codex to external tools and context.
- Codex SDK and app-server support programmatic control of Codex.
- Codex can be used with the OpenAI Agents SDK through MCP for orchestrated
  multi-agent workflows.

Recommended use here:

- Use Codex for engineering, maintenance, browser/computer-use checks, tests,
  adapter implementation, and system upgrades.
- Historical note superseded on 2026-07-09 by
  `docs/decisions/0004-agents-sdk-first-live-ai-team.md`: the OpenAI Agents SDK
  is now the intended first-class live AI Team runner through an internal
  `AgentRuntime` facade. The runtime still owns approvals, costs, state, logs,
  evals, dashboard control, and business hard stops.
- Keep the runtime model-agnostic so Claude, Gemini, ChatGPT subscriptions, and
  paid OpenAI API usage can be routed by evidence and cost.

Official references checked 2026-07-04:

- https://developers.openai.com/codex/app/automations
- https://developers.openai.com/codex/mcp
- https://developers.openai.com/codex/sdk
- https://developers.openai.com/codex/guides/agents-sdk

### Notifications and Control Plane

Slack is optional, not the source of truth. Official Slack docs support
interactive apps, app-triggered events, slash commands, Block Kit components,
and incoming webhooks. This makes Slack useful for approvals and alerts, but the
dashboard should remain canonical.

Recommended order:

1. Dashboard approvals.
2. Email escalation with reply/click approval links.
3. Slack interactive approvals if the operator wants a chat control plane.
4. ClickUp mirror only if task/project reporting becomes valuable.

Official references checked 2026-07-04:

- https://docs.slack.dev/interactivity/
- https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks/

### Accounting

Xero remains the preferred accounting target after revenue begins. The runtime
already separates costs and revenue in durable tables, so the first Xero adapter
can reconcile transactions without changing workflow code.
