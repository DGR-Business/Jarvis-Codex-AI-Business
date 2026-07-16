# Jarvis-Codex Build Log

Status: living operational log
Maintainer: Codex
Started: 2026-07-06
Purpose: preserve decisions, implementation progress, proof results, and next actions inside the repo so future work does not rely on chat history.

## Operating Memory

Jarvis-Codex is a multi-venture AI business operating system. It is not a
single POD tool. POD and digital-product workflows are pilot proofs for a wider
runtime that should eventually research, test, launch, monitor, and improve
different online business ventures under shared controls.

The operator wants to give high-level natural language instructions such as
"find a profitable business idea and prepare mockups" or "research this idea
and run the pipeline if it is worth pursuing." The system should break that
goal into tracked work, use agents only where judgement is useful, use simple
automation where AI is unnecessary, produce polished human-facing outputs, and
stop at approval gates for spend, publishing, legal/compliance, supplier
actions, or other high-risk decisions.

## Current Runtime State

- 2026-07-14 foundation status: the active database truth is one validating
  Digital Products venture, no active real-world test, no verified buyers, no
  revenue, no provider spend, and no consequential item waiting. Historical
  rehearsals remain retained but archived outside the current decision queue.
- Database migrations are versioned through migration 9. They preserve the
  existing database, assign venture ownership, add commercial/evidence/pilot/
  digest state, archive unsupported legacy demo/review noise, mark old
  workflows and outputs as historical, and repoint retained legacy artifact
  paths without deleting audit records.
- Tests use isolated database and artifact roots. Deliverables render
  deterministically to canonical paths rather than appending repeated test
  output to operator files.
- Task claims are atomic and attempts are durable. Approvals are bound to exact
  scope, expire, are single-use, and invalidate when scope changes. Timeout
  outcomes and costs remain unknown until reconciled.
- Local mutation routes require a signed operator session, CSRF token, allowed
  Origin, and matching WebSocket session.
- The desktop cockpit now uses focused APIs and five sections: Command Center,
  Decisions, Business Tests, AI Team, and System. Technical history remains
  accessible without occupying the daily control surface.
- System Outputs shows current work by default. Archived output history is
  available through one explicit control instead of filling the normal view.
- Gumroad CSV import is idempotent by purchase ID, uses a private HMAC buyer
  hash, excludes raw buyer identity from operator/API state, and calculates
  contribution from imported gross, platform fee, refund, and net fields.
- A weekly executive digest records work, buyer proof, cash contribution,
  decisions, exceptions, learning, and the next money move without creating a
  routine interruption.
- The full test suite passes 81/81. Real-browser proof passed at 1440x900,
  1280x720, 1024x768, and 390x844 with zero horizontal overflow and no console
  warnings/errors. The proof ran internal work, previewed its five-page PDF,
  recorded a request-changes decision, updated Activity, and left the active
  queue empty.
- A clean source copy excluded the database, private files, generated outputs,
  dependencies, and local tooling state. `npm.cmd ci` installed from the
  lockfile, 81/81 tests passed, startup and `GET /api/health` passed, and its
  production database contained one venture with zero workflows, tasks,
  approvals, deliverables, experiments, costs, or messages.
- Encrypted backup/restore code and retention are implemented and test-proven.
  A new permanent passphrase and fresh final backup set still require Daniel's
  confirmation because the prior encrypted files' key is not available to the
  current runtime process.
- Private GitHub creation, clean baseline commit/push, and fresh-checkout proof
  remain external action gates.
- Runtime is local Node.js with SQLite persistent state.
- Dashboard is the source of truth for work, approvals, deliverables, costs,
  messages, integrations, monitor findings, and event history.
- External actions default to dry-run. Live publishing, paid spend, account
  actions, and money movement remain hard-stop actions.
- Natural-language command intake can create workflows, tasks, deliverables,
  and optional safe dry-run auto-runs.
- Dry-run agent runner can execute planned internal tasks, record model policy,
  tool policy, estimated cost, actual zero spend, retries, and failures.
- Approval rails support dashboard decisions, dry-run notification outbox,
  action tokens, and conservative reply parsing.
- Runtime monitor records health cycles and findings for approvals, urgent
  messages, stale work, failed tasks, budget pressure, and integration readiness.
- Persistent scheduler jobs now record maintenance work, run monitor cycles, and
  keep the safe-work loop disabled until explicitly enabled.
- Multi-venture scorecards now compare different business types with a score,
  verdict, recommendation, risks, and next actions.
- PDF approval packs can be generated for operator-facing review and include
  commercial scorecard context when available.
- Live research can now be requested as a capped task with approval, cost, event,
  provider-readiness records, a readiness checklist, a smoke-test preparation
  path, and an OpenAI Responses API web-search execution adapter; real execution
  still requires credentials and explicit approval.
- Live AI worker execution can now be requested as a capped approval-gated task
  with provider-readiness records, health/API visibility, and a dashboard smoke
  test path. Approved execution now runs through an internal `AgentRuntime`
  facade with the OpenAI Agents SDK as the primary runner. The preserved OpenAI
  Responses adapter remains lower-level provider infrastructure for fallback and
  direct-call cases. The SDK path records structured output, model-call records,
  worker traces, evals, estimated cost records, and provider-failure no-spend
  evidence.
- Direction correction on 2026-07-09: the OpenAI Responses worker adapter stays
  as lower-level provider infrastructure, but the first-class live AI Team
  execution path is now the OpenAI Agents SDK behind an internal `AgentRuntime`
  facade. The runtime still owns approvals, costs, logs, traces, evals,
  dashboard state, and business rules.
- The commercial brain now turns runtime state into first-screen Money Moves,
  commercial principles, agent/process roles, and a continuous improvement cycle
  using hypothesis, action, expected metric, actual result, learning, and
  improvement.
- Commercial experiments, results, feedback, and learning cycles now provide a
  durable way to compare hypotheses against actual buyer/channel outcomes.
- Research-to-experiment planning now converts idea/research briefs into ranked
  next-test candidates with buyer, problem, offer, channel, price, success
  metric, unit economics, and kill criteria.
- Promoted tests can now generate practical execution packs with offer copy,
  product description, channel steps, tracking plan, result checklist, outreach
  variants, objection prompts, and local outcome buttons.
- Manual market-test command is now one cockpit layer: test options, promoted
  tests, execution packs, AI Team handoffs, run sheets, result capture, reply
  capture, no-response capture, and learning outcomes are visible together
  before any OpenAI model pathway or external channel automation is connected.
- Learning cycles can now generate revised test options locally, preserving
  source links to the learning cycle and execution pack so the system can move
  from result to next controlled market test without a model call.
- AI Team worker operating briefs now translate each worker's durable contract
  into plain operator guidance: what it owns, what it must produce, what
  evidence counts, which tools are safe, which tools need approval, which
  actions are locked, what proof exists, and the next safe step before model
  pathways are connected.
- AI Team protected worker playbooks now define each specialist's local
  execution pattern before model connection: when to use the worker, the first
  protected move, steps, evidence captured, handoff, success metric, stop rule,
  and model-connection rule.
- Protected worker playbooks can now be rehearsed as real local proof runs
  against the current manual market-test context. Rehearsals use normal
  workflow/task/worker-run/trace/eval/cost/event rails, record zero spend and no
  external action, and update playbook rehearsal evidence in dashboard state.
- The AI Team now has protected specialist workers wired into commercial work:
  offer design, product scope, copy, distribution, customer signal, result
  analysis, and Chief-of-Staff review all create durable runs, traces, and
  quality checks.
- The dashboard now has a simplified five-section cockpit backed by derived
  `operatorCockpit` and `aiPilotReview` read models. Demand Validator pilot
  preparation can move from protected proof, to playbook rehearsal, to capped
  comparison packet, to an approval decision without requiring the operator to
  inspect raw records.

## Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-07-06 | Keep this log as durable project memory. | User wants long autonomous build sessions without relying on chat context. |
| 2026-07-06 | Treat the system as multi-venture infrastructure. | Future businesses may differ from POD/digital products, so shared runtime layers must stay generic. |
| 2026-07-06 | Add scheduler/maintenance as the next foundation layer. | Safe autonomy needs persistent jobs, run records, monitoring, and controlled background work. |
| 2026-07-06 | Treat ChatKit as a later chat/control surface, not the runtime core. | Official OpenAI docs say Agent Builder is deprecated; ChatKit remains useful when backed by our own server-side agent implementation. |
| 2026-07-06 | Separate live-research spend approval from provider readiness. | Approval alone must not imply the system can spend or browse; credentials, live flags, and adapter readiness must also pass. |
| 2026-07-06 | Clean the active repo before new feature work and archive Claude-era surfaces. | The Codex runtime needs one clear home; legacy files remain reference-only under `archive/historical/`. |
| 2026-07-06 | Make digital products the first commercial pilot direction. | Digital products should be easier to control than POD/Gelato while still proving research, creation, approvals, publishing planning, and performance loops. |
| 2026-07-06 | Make commercial judgement and continuous improvement first-class runtime behavior. | The system should become a money-focused operating cockpit, not a manual document pipeline. |
| 2026-07-07 | Add commercial results as the feedback bridge between market reality and system decisions. | Money Moves and scorecards must react to actual outcomes, not only research packs and workflow status. |
| 2026-07-07 | Add a research-to-experiment bridge before adding more integrations. | The system should turn research into measurable commercial tests before live channels, paid tools, or broad automation are expanded. |
| 2026-07-07 | Add execution packs before live channel automation. | A promoted test should become simple to run and record manually before email, publishing, or spend adapters are trusted. |
| 2026-07-07 | Wire AI Team specialists into the commercial loop before live autonomy. | Workers should prepare and analyze real operator decision points before any live model/tool execution is trusted. |
| 2026-07-07 | Add live worker readiness before live OpenAI-backed execution. | The AI Team needs approval, setup, budget, and trace rails before any worker can spend money or use external model/tool calls. |
| 2026-07-07 | Superseded 2026-07-09: use the Responses API as the first live worker execution path. | Historical decision preserved for context. Superseded because the AI Team destination needs specialist workers, handoffs, tracing, guardrails, and resumable approvals that fit the Agents SDK as the primary runner. Responses remains useful lower-level provider infrastructure. |
| 2026-07-08 | Add a manual market-test cockpit before connecting OpenAI pathways. | The operator needs one practical business command surface for running, approving, recording, and learning from small manual tests before model calls or channel automation add complexity. |
| 2026-07-08 | Add learning-to-revised-test generation before model connection. | Actual results should automatically become the next ranked market-test options locally, instead of forcing the operator to interpret learning rows or wait for live AI execution. |
| 2026-07-08 | Add worker operating briefs before model connection. | The AI Team should be inspectable and commandable in business language before any OpenAI-backed worker execution is trusted. |
| 2026-07-08 | Add protected worker playbooks before model connection. | The AI Team needs repeatable local execution patterns, not only role descriptions, before live model-backed labour is trusted. |
| 2026-07-08 | Make protected worker playbooks executable as rehearsals. | The AI Team should practice its local playbooks against the business test queue before any OpenAI-backed worker execution is trusted. |
| 2026-07-09 | Use Agents SDK as the first-class live AI Team execution path. | The system destination is specialist business workers under approval. Agents SDK better matches worker loops, handoffs, tracing, guardrails, and resumable approvals while Jarvis keeps ownership of state, approvals, costs, logs, evals, dashboard state, and business rules. |
| 2026-07-09 | Implement `AgentRuntime` as the live-worker facade before any real provider pilot. | Keeps OpenAI SDK/provider details behind Jarvis approval, cost, trace, eval, dashboard, and failure rails while allowing the Demand Validator pilot to prove one specialist worker path first. |
| 2026-07-09 | Implement Plan 2 as derived cockpit and AI pilot review state, not a new source of truth. | Operator clarity needed improving before real AI output was introduced. The cockpit should simplify command, decisions, business tests, AI pilot evidence, and system risk while preserving existing approvals, costs, traces, evals, and Workbench rails. |
| 2026-07-14 | Execute Foundation-to-First-Revenue before adding wider capabilities. | One recoverable digital-product loop must prove real value before the system expands. |
| 2026-07-14 | Use Gumroad Direct for the first checkout and fulfilment path. | It gives the smallest practical digital-product revenue loop; fees and export fields will be rechecked immediately before launch. |
| 2026-07-14 | Allow private platform KYC but keep the public venture faceless and voiceless. | Required identity checks may be completed privately without making Daniel the public brand. |
| 2026-07-14 | Earn autonomy per exact capability after five consecutive reviewed successes. | A worker must not receive global autonomy because one narrow task performed well. Any failure resets and suspends that capability. |
| 2026-07-14 | Limit normal operator time to eight hours weekly and require approval for any intensive week up to 16 hours. | The system must reduce Daniel's workload rather than disguise a manual pipeline as autonomy. |
| 2026-07-14 | Archive unsupported legacy proof state instead of deleting it or presenting it as business truth. | Audit evidence remains available in System/SQLite while current decisions, reviews, tests, spend, and buyer metrics stay honest. |
| 2026-07-05 | Dashboard remains canonical even if email, Slack, ClickUp, or mobile views are added later. | Avoid scattered truth and keep operator control simple. |
| 2026-07-05 | Dry-run proof stays ahead of live tool use. | Prevent fake autonomy, runaway spend, and accidental external actions. |

## Build Journal

### 2026-07-06 - Durable Build Log Started

Created this log to capture what was built, why it was built, what remains
unbuilt, and which gates still need operator decisions. This document should be
updated after meaningful foundation changes.

Next foundation target: persistent scheduler and maintenance loop so the runtime
can record scheduled jobs, run monitor cycles, and later run approved safe work
without needing manual clicks.

### 2026-07-06 - Scheduler and Maintenance Layer Implemented

Added persistent scheduler jobs and scheduler run records. The default enabled
job runs runtime monitor cycles. The safe dry-run work loop exists, but is
disabled by default until the operator explicitly enables narrow autopilot.

Implemented server API controls for viewing scheduler status, running due jobs,
running a named scheduler job, and enabling/disabling jobs. The local server now
starts a conservative scheduler poller after the dashboard binds successfully.
The dashboard shows scheduler status in Signals and includes a Run due checks
button.

Hardened monitor escalation so repeated monitor cycles do not create duplicate
urgent messages about already-open urgent messages. Improved approval-pack PDF
rendering so Windows npm runs and bundled Codex runs both locate the same bundled
Python/PDF tooling where available.

Verification: `npm test` passed 17/17 tests on 2026-07-06.


### 2026-07-06 - OpenAI Agent Stack Direction

Reviewed OpenAI's current agent guidance. Agent Builder is deprecated and should
not become our foundation. The recommended architecture is to keep Jarvis-Codex
runtime as the business operating system, add Agents SDK as the code-first agent
execution layer, and later add ChatKit as the embedded chat/control interface
inside the dashboard.

No code changes were made for ChatKit yet. It is now planned as a later
integration after Agents SDK-backed execution, permissions, approvals, and state
are stable.

### 2026-07-06 - Multi-Venture Scorecards Implemented

Added durable commercial scorecards so the system can compare POD, digital
products, content plays, and broader business ideas using shared criteria rather
than treating the pilots as the whole architecture.

Each scorecard records demand signal, monetisation path, execution fit, risk
control, evidence quality, automation readiness, a total score, a verdict, risks,
and next actions. Dry-run-only evidence is deliberately scored as research
required, so the system does not overstate commercial proof before live research
exists.

Scorecards are generated automatically when a workflow reaches operator-pack QC.
Startup also backfills scorecards for existing ready-for-review workflows. The
dashboard state and workflow inspector expose scorecard status, and approval-pack
PDFs include the scorecard section when available.

Verification: `npm test` passed 17/17 tests on 2026-07-06. Live local state at
`http://127.0.0.1:5051` reported 3 scorecards after backfill; latest verdict was
`research_required` with a latest score of 38/100.

### 2026-07-06 - Live Research Request Rail Implemented

Added a Stage 2 bridge from dry-run evidence to live commercial evidence. A
workflow can now request live research, which creates a dedicated
`live_market_research` task with a capped estimate, approval record, zero-spend
cost record, notification/action-token escalation, and event history.

The spend gate now checks provider readiness after approval. For live research,
that means `OPENAI_API_KEY`, `JARVIS_ENABLE_LIVE_RESEARCH=1`, and runtime adapter
readiness must all pass before the task can execute. If anything is missing, the
task remains blocked, records that no spend occurred, and creates an urgent
provider-setup message.

The dashboard workflow inspector now has a Request live research action. The API
also exposes `POST /api/workflows/:id/request-live-research`.

Verification: bundled Node test run passed 18/18 tests on 2026-07-06.

### 2026-07-06 - OpenAI Live Research Adapter Implemented

Implemented the live research provider path using the OpenAI Responses API with
the hosted `web_search` tool. The adapter builds a structured commercial research
prompt, forces web search, captures cited sources and hosted search results,
records a live research run, logs model/cost estimates, updates deliverables,
and upgrades scorecards when live evidence is captured.

The failure path now records a `failed_live` research run and error event before
orchestrator retry/failure handling. This preserves audit evidence even when the
provider fails before returning usable research.

Verification: bundled Node test run passed 20/20 tests on 2026-07-06. Tests use
stubbed OpenAI responses only; no real API spend occurred.

### 2026-07-06 - Live Research Readiness and Smoke Control Added

Added a durable live-research readiness surface that reports the OpenAI key,
live research flag, adapter availability, budget room, and per-run approval
state. `/api/health`, dashboard state, and the Integrations tab now expose the
same readiness picture.

Added `POST /api/live-research/smoke-test`, which prepares a low-cap live
research smoke-test workflow and approval without calling OpenAI. The dashboard
Integrations tab now includes a Prepare smoke test action that creates this
approval-gated work and sends the operator to Approvals.

Verification: bundled Node test run passed 22/22 tests on 2026-07-06. No real
API spend occurred.

Runtime check: local server was restarted on port 5051. `/api/health` and
`/api/state` report live research as blocked, with blockers for missing
`OPENAI_API_KEY` and `JARVIS_ENABLE_LIVE_RESEARCH`. One smoke-test approval is
pending, the associated live research task is blocked, and the recorded spend is
0 cents. Browser-level Playwright verification was attempted but not counted
because the local Playwright daemon rejected its isolated-browser configuration.

### 2026-07-06 - Codex Home Cleanup And Digital-Product Direction

Archived Claude-era active surfaces, old audit/tooling reports, local tool
state, and old publish runbooks under `archive/historical/`. The active Codex
runtime now points at `AGENTS.md`, current `docs/`, and current `config/`
instead of `CLAUDE.md` or archived hooks/agents.

Added current security, delivery, operating-procedure, archive, and decision
records. Updated guardrails so Stage 1 remains dry-run by default, external
actions and spend stay gated, and digital products are the first commercial
pilot direction.

Converted the seeded proof workflow from the old POD/Gelato batch to a
digital-product pilot proof. Added a digital-product dry-run publish adapter and
updated tests so the default approval gate proves listing/delivery planning
without live publishing, paid asset generation, or spend. Archived the previous
local SQLite runtime state under `archive/historical/local-artifacts/` so the
dashboard reseeds cleanly.

Verification: `npm.cmd test` passed 22/22 tests on 2026-07-06. Local server
started on port 5051. `/api/health` reported `ok: true`, `mode: dry-run`, no
live research credentials, and live research blocked as expected. Real browser
verification loaded the dashboard, confirmed the current focus is
`Digital product pilot proof`, confirmed the old POD proof is absent, clicked
Run monitor, Check integrations, and Run safe step, and confirmed the Events tab
recorded monitor, integration, and dry-run approval-escalation evidence with no
browser console errors.

### 2026-07-06 - Dashboard Design Lab Added

Created a review surface at `/design-lab.html` with five dashboard/cockpit
directions derived from five parallel design-agent briefs: Dark Command Center,
Light Executive Suite, Venture Scorecard Cockpit, Timeline Operations Board, and
Control Room Ledger. The design lab uses live runtime state from `/api/state`
and is intentionally separate from the working dashboard until the operator
chooses a preferred direction.

Verification: `npm.cmd test` passed 22/22 tests. Browser verification loaded the
design lab, confirmed five selectable concepts, live digital-product runtime
data, tab switching, no console warnings/errors, and no horizontal overflow on
desktop or a 390px mobile viewport. Visual QA fixed compact-table clipping and
mobile SVG icon sizing before handoff.

### 2026-07-06 - Dark Command Dashboard Direction Applied

Applied the operator's preferred dashboard direction to the live dashboard:
Dark Command Center is now the default visual system, and Venture Scorecard is a
dedicated tab inside the main dashboard. The first screen focuses on business
and system control: current mission, decisions needed, work in motion, budget,
alerts, connection readiness, protected operating mode, and command intake.

Added a human-facing display layer so backend state names such as
`blocked_for_approval`, `monitor.completed`, `scheduler.job.completed`, and
`dry_run_only` remain available to code but render as ordinary business
language on the site, such as "Needs your approval", "System check complete",
"Scheduled check complete", and "Protected mode".

Verification: `node --check public\app.js`, `node --check public\design-lab.js`,
and `npm.cmd test` passed 22/22 tests. Browser verification loaded
`http://127.0.0.1:5051/`, checked the Overview, Work Queue, and Venture
Scorecard tabs, confirmed no visible raw status labels in the rendered text,
confirmed no console warnings/errors, confirmed no desktop horizontal overflow,
and smoke-checked a 390px mobile viewport for horizontal overflow. Final visual
screenshots were inspected for the overview and scorecard cockpit.

### 2026-07-06 - Scorecard, Approval Pack, and Smoke Gate Prepared

Repaired the completed digital-product proof so its Venture Scorecard is created
durably when the digital-product approval dry-run completes. The current
digital-product proof now persists as `Digital Product`, scores 52/100, and
shows a "Research needed" verdict in the dashboard instead of remaining absent
from the scorecard tab.

Generated the first PDF approval pack for the digital-product proof at
`output/pdf/Digital product pilot proof Approval Pack (for approval).pdf`. The
PDF renderer now translates internal workflow states, scorecard verdicts,
confidence values, task statuses, and model-policy classes into operator-facing
language before rendering.

Prepared the first capped live-research smoke workflow for a low-risk digital
product idea with a 100 cent estimate. It created one pending live-research
approval and one blocked live-research task, recorded zero actual spend, and
correctly remains blocked until `OPENAI_API_KEY`, `JARVIS_ENABLE_LIVE_RESEARCH`,
provider readiness, budget, and explicit operator approval all pass.

Updated the master plan so the next Stage 2 action is no longer choosing a smoke
test idea; it is resolving setup and approval for the queued capped smoke test.

Verification: `npm.cmd test` passed 22/22 tests, the approval-pack renderer
passed Python syntax compilation using the bundled runtime, the generated PDF
was rendered to PNG and inspected, `GET /api/health` returned ok in dry-run mode
with one pending smoke test and zero monthly spend, and the dashboard was
restarted on `http://127.0.0.1:5051/`. In-app browser checks loaded the Overview,
clicked the Venture Scorecard tab, confirmed the 52 score, "Research needed",
digital-product channel, no raw backend labels, no console warnings/errors, and
no desktop horizontal overflow. The in-app screenshot API returned blank dark
captures in this environment, so screenshot files from that API were not treated
as visual proof.

### 2026-07-06 - Workflow Decisions and PDF Preview Added

Added contextual decision controls to the workflow detail inspector. When a
workflow has a pending approval, selecting that workflow now shows the decision
card and the operator can approve, request changes, or deny directly from the
workflow details instead of moving to the Approvals tab.

Added a dashboard PDF preview flow for Review Outputs. Registered PDF
deliverables now have a Preview PDF action, and clicking a PDF review-output row
opens an in-dashboard preview modal with a fullscreen link. The server exposes a
narrow `GET /api/deliverables/:id/file` endpoint that only streams registered
PDF deliverables which resolve inside the workspace.

Verification: `node --check public\app.js`, `node --check src\server.js`, and
`npm.cmd test` passed 23/23 tests, including API coverage for the PDF preview
endpoint. Browser verification loaded `http://127.0.0.1:5051/`, selected a
workflow with a pending smoke-test approval, confirmed Approve, Request Changes,
and Deny buttons in the workflow detail panel without clicking any decision
button, opened and closed the PDF preview from Review Outputs, confirmed the PDF
endpoint returned `application/pdf`, confirmed no console warnings/errors, and
confirmed no desktop horizontal overflow. Browser QA prepared one safe
live-research smoke approval for this check; no provider call or spend occurred.

### 2026-07-06 - Commercial Brain and Money Moves Added

Promoted business judgement from a planning idea into runtime state. The system
now computes a commercial brain from workflows, approvals, scorecards,
deliverables, research sources, cost records, and revenue records. It exposes
commercial principles, required business roles/processes, key money metrics,
prioritised Money Moves, and a continuous improvement loop.

Money Moves are now on the first dashboard screen. Each card shows the action,
expected upside, cost cap, evidence, hypothesis, and direct controls such as
Preview Pack and Open Workflow. Verdicts and status text are translated into
ordinary operator language, so internal labels do not leak into the dashboard.

The master plan and runtime instructions now treat commercial judgement,
operator simplicity, and continuous improvement as core rules: every meaningful
commercial action should state its hypothesis, smallest useful action, expected
metric, actual result, learning, and improvement.

Verification: `node --check src\runtime\commercial-brain.js`,
`node --check public\app.js`, and `npm.cmd test` passed 24/24 tests.
`GET /api/health` returned ok in dry-run mode with zero spend recorded.
`GET /api/state` returned 5 Money Moves and the
`hypothesis_action_result_improvement` model. Browser QA loaded
`http://127.0.0.1:5051/`, confirmed Money Moves are visible on the overview,
confirmed no raw backend labels were visible, opened a PDF preview from a Money
Move, opened the workflow inspector from a Money Move, confirmed workflow
controls were available, confirmed no console warnings/errors, and confirmed no
desktop horizontal overflow.

### 2026-07-07 - Commercial Results and Learning Engine Added

Added a durable commercial results layer so the system can record market tests,
actual results, customer signal, and learning decisions. New runtime tables
capture commercial experiments, result rows, feedback rows, and learning cycles.
Result rows can record views, clicks, leads, sales, refunds, revenue, spend,
time, and notes. Feedback rows can capture sentiment, rating, objections, and
requests.

The learning engine now compares the experiment hypothesis and expected metric
against actual results, then records a verdict: continue, revise, stop/rework,
or needs evidence. Recorded revenue and spend also flow into the existing
finance ledgers. Scorecards now use commercial outcomes when scoring demand,
monetisation, evidence quality, risk, and confidence. Money Moves now include
learning-signal cards when actual outcomes create a scale/revise/stop decision.

The dashboard now has a Results tab with manual result entry, actual commercial
signal metrics, recent learning cycles, and a result ledger. Workflow inspectors
also include a Record Result action so the operator can jump straight from a
workflow into evidence capture without hunting through files or database rows.

Verification: `node --check` passed for the new and touched runtime/UI files,
and `npm.cmd test` passed 26/26 tests. `GET /api/health` returned ok in
dry-run/protected mode. Browser QA loaded `http://127.0.0.1:5051/`, opened the
Results tab, recorded a zero-spend/zero-revenue local QA result, confirmed the
result ledger and learning loop updated, confirmed Money Moves showed a
human-readable Learning signal, and confirmed no raw backend labels or console
warnings/errors were visible. The browser screenshot exposed a cramped Result
Ledger layout, so the Results tab was corrected to use a full-width ledger band
with non-wrapping table headers.

### 2026-07-07 - Research-To-Experiment Bridge Added

Added the Stage 2A bridge that converts a research note or operator idea into
ranked commercial test options. New durable tables store commercial briefs and
test candidates. Each candidate records buyer, problem, offer, channel, price,
gross margin estimate, cost cap, evidence score, confidence, hypothesis,
smallest action, expected metric, success metric, kill criteria, risk, and
promotion state.

The generator applies the system's business frameworks directly in runtime
state: Money Move Contract, AARRR funnel, ICE-style prioritisation, Unit
Economics Gate, and Build-Measure-Learn. The top candidate now appears as a
Next test Money Move, and promoting a candidate creates a commercial experiment
without live spend, publishing, or account action.

The dashboard now has a Next Tests tab with a test-option generator, recommended
candidate cards, commercial filters, and a test option ledger. Workflow details
also include a Plan Next Test action, while Money Move cards can promote the
recommended test directly.

Verification: `node --check` passed for the new and touched runtime/UI files,
and `npm.cmd test` passed 29/29 tests. `GET /api/health` returned ok in
dry-run/protected mode. Browser QA loaded `http://127.0.0.1:5051/`, opened the
Next Tests tab, confirmed the form, framework filters, and candidate ledger
rendered without raw backend labels or console warnings/errors, generated three
ranked test options from a local QA brief, promoted the top option into a
commercial experiment, confirmed the top Money Move advanced to the next
unpromoted test, and confirmed no spend or revenue was recorded. Desktop QA
found a retained scroll position in the Recommended Next Test panel after
promotion, so the panel now resets to the top after render. Desktop and narrow
viewport checks showed no page-level horizontal overflow.

### 2026-07-07 - Test Execution Packs and Outcome Shortcuts Added

Added the Stage 2B execution-pack layer. A promoted commercial test can now
generate a durable local pack with offer-page copy, product description, call to
action, manual channel plan, tracking plan, result checklist, outreach variants,
objection prompts, and result shortcuts. The pack is tied back to the promoted
experiment, test candidate, brief, workflow, and venture.

Money Moves now prioritise promoted tests that need an execution pack before
more planning work. Once a pack exists, the dashboard shows it in Next Tests
with Open Pack, Record Result, and Mark No Response controls. The pack
inspector shows the practical copy/checklist/tracking material plus Record
Result, Record Reply, and Mark No Response buttons. These actions write to the
existing commercial results, feedback, and learning-cycle ledgers, so no-response
and buyer-reply signals improve the system instead of becoming loose notes.

The execution pack remains manual and protected: it does not send messages,
publish externally, create accounts, or spend money. It is a practical command
surface for the operator to run a small market-contact test and then record what
actually happened.

Verification: `node --check` passed for the new and touched runtime/UI files,
and `npm.cmd test` passed 32/32 tests. `GET /api/health` returned ok in dry-run
mode on `http://127.0.0.1:5064/`. Browser QA loaded the dashboard, generated an
execution pack from the top Money Move, opened the Next Tests tab, confirmed the
pack card and inspector use human-facing language with no raw backend labels,
recorded a No Response outcome from the pack button, confirmed the Results tab
and learning loop updated, confirmed spend and revenue stayed at zero, and
confirmed no console warnings/errors or desktop horizontal overflow. Desktop QA
also found and fixed a layout issue where framework chips crowded the execution
pack card; the panel now prioritises pack controls when a pack exists. The
temporary QA no-response result was then removed from local runtime state and
the pack was returned to Ready to test for real operator use.

### 2026-07-07 - AI Team Foundation Added

Added the first durable AI Team foundation. The runtime now has protected-mode
worker definitions for Chief of Staff, Opportunity Scout, Demand Validator,
Offer Architect, Product Builder, Copy and Conversion Agent, Distribution
Agent, Finance and Unit Economics Agent, Customer Voice Agent, Growth Analyst,
and Quality Reviewer. Each worker has a role, model class, instructions,
allowed tools, guardrails, handoff targets, input/output contract, approval
policy, quality criteria, and hard-stop rules for external publishing, paid
spend, account actions, money movement, legal/compliance decisions, and customer
disputes/messages.

Agent execution now creates durable worker-run records, trace events, and
quality/eval results when protected dry-run tasks execute. The runner records
policy selection, model-route proof, guardrail checks, tool/research results,
deliverable updates, evaluation checks, completion, and failures. Task results
now include the AI worker identity, worker run id, eval id, eval status, score,
and any Chief-of-Staff handoff required for human review.

The dashboard now has an AI Team tab. It shows the worker roster, current
contracts, protected-mode status, latest run, hard-stop areas, worker-run
ledger, and quality checks. Clicking a worker, run, or quality check opens the
inspector with ordinary business language rather than backend labels.

This foundation follows the official OpenAI agent-building principles used for
the implementation plan: narrow specialist definitions, runner loop state,
manager-style orchestration, human review around sensitive actions,
observability/traces, and eval checks. It does not enable live model calls,
external actions, or OpenAI Agents SDK execution yet; those remain gated behind
credentials, cost approval, provider readiness, and additional tests.

Verification: `npm.cmd test` passed 32/32 tests. A broad raw
`node --test --test-isolation=none` command was also tried and showed that
Node's default test discovery still sees retired Claude-era Vitest tests inside
`archive/historical/`; the active package test script already scopes
verification to `test/runtime.test.js`.

### 2026-07-07 - AI Team Specialist Chain Connected

Connected the protected AI Team to the commercial money loop instead of leaving
it as a roster and dry-run task ledger only. Command plans now include
specialist tasks for offer architecture, smallest sellable product scope, copy
and conversion, distribution planning, customer signal capture, and result
analysis. Their outputs write useful details into review deliverables.

Execution-pack generation now records protected Product Builder, Copy and
Conversion, and Distribution worker runs. The pack metadata stores those worker
run ids so the dashboard can connect the practical pack to the people/processes
that prepared it. Recording a commercial result now creates a Growth Analyst
run, and recording buyer feedback creates a Customer Voice run. These runs stay
dry-run/protected: no message sending, publishing, account action, paid model
call, or spend occurs.

Dashboard labels were updated so the new worker tasks read as ordinary business
language. Tests now assert that execution packs, results, feedback, and dry-run
workflow execution create the expected specialist worker runs, evals, and
metadata links.

Verification: `node --check` passed for the touched runtime and dashboard
files, and `npm.cmd test` passed 32/32 tests on 2026-07-07. Real-browser
dashboard verification should be run after the local server is restarted with
these new backend changes.

### 2026-07-07 - Live AI Worker Readiness Bridge Added

Added the first live-worker bridge for the AI Team without enabling live spend.
The runtime now exposes AI Worker Execution as an integration, a live-worker
readiness report, health API data, capped smoke-test preparation, and
workflow-level requests for a live worker test. Requests create a
`live_ai_worker_execution` task, a pending `live_ai_worker_spend` approval, a
zero-amount cost record, notification outbox entry, event history, and visible
dashboard readiness blockers.

The bridge deliberately stops short of claiming true live autonomy. If approval
and provider setup pass before the real adapter exists, the runner records that
the adapter is missing and prevents a dry-run fallback from marking the work as
complete. This follows the official OpenAI agent-building direction used here:
narrow workers, server-side orchestration state, tool/approval controls,
traces/results, guardrails, and evals before live execution.

Dashboard changes: the AI Team tab now has a Live Worker Readiness panel with
plain-language setup checks and a Prepare Worker Test action. Workflow inspector
actions now include Request Live Worker beside Request Live Research.

Verification: `node --check` passed for the touched runtime, dashboard, and test
files. `npm.cmd test` passed 35/35 tests. The server was restarted on
`http://127.0.0.1:5067`; `/api/health` exposed `liveAiWorkers` as blocked for
OpenAI key/live-model flag with adapter and budget ready. In the real in-app
browser, the AI Team readiness panel showed the same blockers, Prepare Worker
Test created one pending Live worker spend approval, the task stayed blocked,
the cost record remained `approval_requested` with 0 cents, and browser console
logs had no warnings or errors.

### 2026-07-07 - Live AI Worker Adapter Implemented

Implemented the first real live-worker execution adapter behind the existing
approval and provider-readiness gates. `live_ai_worker_execution` no longer
falls through to a placeholder failure when setup is complete. Instead, approved
tasks call the OpenAI Responses API with a narrow worker prompt, no external
tools, strict structured JSON output, and runtime context from the workflow,
command, recent tasks, and scorecard.

Successful live worker execution now records:

- a live `model_calls` row with token usage, selected model, estimated/actual
  capped cost, exact-billing-pending metadata, and response id;
- a cost ledger update from `approval_requested` to `incurred_estimate`;
- a completed AI Team run in `live-ai-worker` mode;
- trace events for guardrails, model completion, deliverable update, eval, and
  run completion;
- an eval result and operator-readable output in the task result;
- a `live_ai_worker.completed` event.

Provider failure now records a failed live model call, failed AI Team run,
`provider_failed_no_spend` cost state with zero amount, urgent task failure, and
`live_ai_worker.failed` event. No dry-run fallback can mark a live worker task
complete.

This follows the official OpenAI guidance used for this build: guardrails and
human review decide when a run continues or stops, result surfaces should expose
final output/state/usage for audits, structured outputs reduce malformed model
responses, and traces should capture model calls, tools, guardrails, handoffs,
and custom workflow spans.

Verification: `node --check` passed for the new adapter, runner, dashboard, and
tests. `npm.cmd test` passed 37/37 tests, including approved live-worker
success and provider-failure no-spend paths with stubbed OpenAI responses. The
server was restarted on `http://127.0.0.1:5068`; `/api/health` exposed
`liveAiWorkers` as blocked for OpenAI key/live-model flag with adapter and
budget ready. In the real in-app browser, the AI Team tab showed 11 ready
workers, a plain-language Live Worker Readiness panel, one pending decision, no
raw backend approval scope text, and no console warnings or errors.

### 2026-07-07 - AI Team Handoff Layer Added

Added durable worker handoffs so the AI Team behaves more like a managed
business workforce. The database now has `agent_handoffs` records with source
run, source worker, next worker, workflow/task links, status, summary, risk,
approval flag, and a plain-language decision needed. When a worker completes
and names a next owner, the runtime creates or updates the handoff and records
a trace event plus an activity event.

The first digital-product commercial loop now uses this handoff layer.
Distribution Agent handoffs ask the Chief of Staff/operator whether to run the
manual market-contact test, request changes, or stop. Growth Analyst and
Customer Voice handoffs ask whether a result or buyer signal should lead to
continue, revise, pause, or stop. Live AI worker execution also creates a
Chief-of-Staff handoff after a structured model result, keeping the next
business decision visible.

Dashboard changes: the AI Team tab now includes Active Handoffs. Each card
shows the route from worker to next owner, the business decision needed, status,
risk, and workflow shortcut. The inspector understands worker handoff records
and shows related approval buttons when a pending workflow decision exists.

This follows the official agent guidance used in this build: applications
should carry result state across handoff boundaries, approval interruptions
should be resumable state rather than hidden restarts, and traces should expose
model calls, tool calls, handoffs, guardrails, and custom spans.

Verification: `node --check` passed for `src/db.js`, `src/runtime/ai-team.js`,
`src/runtime/test-execution-pack.js`, `src/runtime/commercial-results.js`,
`public/app.js`, and `test/runtime.test.js`. `npm.cmd test` passed 37/37 tests,
including dry-run worker handoffs, execution-pack handoffs, and live-worker
handoffs after stubbed OpenAI Responses execution. Browser QA used a temporary
dashboard database on `http://127.0.0.1:5071/`, created and auto-ran one
protected digital-product workflow, and confirmed the AI Team tab showed 11
ready workers, 11 worker-run rows, 8 visible quality checks, 2 waiting active
handoffs, ordinary decision/risk wording, and no matches for the raw phrases
`monitor.completed`, `scheduler.job.completed`, `dry-run active`, or
`approval gate`. The temporary QA servers/databases were removed, and the main
dashboard was restarted on `http://127.0.0.1:5069/`; `/api/health` returned ok
in dry-run mode.

### 2026-07-07 - AI Team Handoff Triage Added

Upgraded worker handoffs from visible records into decidable business controls.
The runtime now accepts Approve, Request Changes, and Deny decisions for
`agent_handoffs`. Each decision stores the operator note in handoff metadata,
sets a final handoff status, records a worker trace event, and writes an
activity event. Requesting changes or denying also stops the linked workflow as
needs changes and creates an operator message so the issue does not disappear
inside the AI Team ledger.

Dashboard changes: worker handoffs now appear in the Overview decision queue
alongside normal approvals. Active Handoff cards and the handoff inspector show
Approve, Request Changes, and Deny buttons directly, plus workflow shortcuts.
The worker-run detail now uses plain "Review needed" language instead of
backend control wording.

This keeps the AI team aligned with the official agent implementation principles
used in this build: handoffs are explicit state boundaries, human review
interruptions are durable/resumable rather than hidden prompts, and traces keep
the model/tool/handoff/evaluation history inspectable.

Verification: `node --check` passed for `src/runtime/ai-team.js`,
`src/server.js`, `public/app.js`, and `test/runtime.test.js`. `npm.cmd test`
passed 38/38 tests, including a new worker-handoff changes test and an HTTP API
handoff approval test. Browser QA used an isolated temporary dashboard on
`http://127.0.0.1:5073/`, created one protected digital-product workflow,
confirmed Overview showed active worker handoffs with Approve / Request Changes
/ Deny, clicked Request Changes on one handoff, and verified the handoff became
`changes_requested`, the workflow became `needs_changes`, and trace/activity
events were recorded. Browser console warnings/errors were empty, the temporary
server/database were removed, and the main dashboard was left running on
`http://127.0.0.1:5072/`.

### 2026-07-07 - Chief-of-Staff Handoff Follow-Up Added

Approved worker handoffs now create real continuation work. When the operator
approves an `agent_handoffs` record, the runtime queues a protected
`handoff_followup` task owned by the Chief of Staff, records the follow-up task
id in the handoff decision metadata, updates the linked workflow to show that
internal follow-up is queued, and writes both a trace event and an activity
event. Request Changes and Deny remain stop paths that mark the workflow as
needs changes.

The follow-up task uses the normal dry-run worker runner: model policy,
tool restrictions, cost cap, worker run, trace events, eval result, task result,
deliverable updates, and dashboard state. Its output turns the approved handoff
into a plain-language next safe business move while keeping external send,
publishing, customer contact, and payments blocked behind separate approval.

Dashboard changes: decided handoffs can now link directly to the follow-up task,
and the new event/task kind is labelled in ordinary language.

This follows the official agent guidance used in this build: handoff results are
continuation surfaces, approval review should resume from stored state rather
than restart work, and traces should preserve the model/tool/handoff/guardrail
record for later debugging and evals.

Verification: `node --check` passed for `src/runtime/ai-team.js`,
`src/runtime/agent-runner.js`, `public/app.js`, and `test/runtime.test.js`.
`npm.cmd test` passed 39/39 tests, including a new approved-handoff follow-up
test that queues and runs the Chief-of-Staff task plus an HTTP API assertion
that approved handoffs expose the queued follow-up task. Browser QA used an
isolated temporary dashboard on `http://127.0.0.1:5074/`, clicked Approve on an
active worker handoff from the Overview, confirmed the handoff left the active
queue, confirmed the Chief-of-Staff follow-up task appeared, ran the queued
follow-up to completion, and saw no browser warnings or errors. The temporary
server/database were removed, and the main dashboard was restarted with the
updated code on `http://127.0.0.1:5072/`; `/api/health` returned ok in dry-run
mode.

### 2026-07-07 - Chief-of-Staff Next Business Actions Added

Approved worker handoffs now flow into a clearer business command surface.
The protected Chief-of-Staff follow-up task produces a structured next business
action with title, recommendation, hypothesis, smallest useful action, expected
metric, kill criteria, evidence, risk, cost cap, hard stops, workflow link, task
link, and handoff link. The runner records this recommendation in the task
result, writes a plain-language operator message, emits a
`commercial.next_action_recommended` activity event, and adds a worker trace
event for auditability.

The commercial brain now reads completed Chief-of-Staff follow-up tasks and
turns the latest recommendations into Money Moves. The Overview card exposes
the useful controls directly: Open Follow-Up, Plan Next Test, Generate Review
Pack, and Open Workflow. This keeps the AI Team aligned with the operating
principle that workers do the processing and the operator sees the money move,
evidence, risk, cap, and next decision without digging through documents.

This continues the official agent-building pattern used in this repo: handoff
results are continuation surfaces, human review remains durable/resumable, side
effect tools stay separately approval-gated, traces preserve the worker path,
and structured outputs make downstream UI and evals reliable.

Verification: `node --check` passed for `src/runtime/agent-runner.js`,
`src/runtime/commercial-brain.js`, `src/runtime/state.js`, `public/app.js`,
and `test/runtime.test.js`. `npm.cmd test` passed 39/39 tests. Browser QA used
an isolated temporary dashboard on `http://127.0.0.1:5082/`, created and
auto-ran one protected digital-product workflow through the command form,
approved a worker handoff from the Overview, confirmed the Chief-of-Staff
follow-up task was queued, ran the linked workflow from Work Queue, and
confirmed the Overview showed a Next business action Money Move with Open
Follow-Up, Plan Next Test, Generate Review Pack, and Open Workflow controls.
The follow-up inspector showed the next business action and success measure,
the activity feed showed Next business action ready, no raw backend wording was
visible for the checked phrases, and browser warning/error logs were empty.

### 2026-07-07 - Worker Business Decision Contracts Added

Added the first shared output contract for the AI Team. Every protected worker
run now carries a `jarvis_worker_business_decision_v1` business decision with
buyer, problem, offer, channel, money move, evidence summary, risk, expected
metric, stop/change rule, approval state, hard stops, and
continuous-improvement fields. The separate `jarvis_worker_contract_v1` record
maps each worker's required output fields into a normalized `contractOutput`
object so specialist work can be checked consistently.

The evaluator now checks the business decision contract and required output
contract fields before a worker result is treated as passed. Vague output can
still be recorded, but it will be flagged by evals rather than silently
becoming operator-ready work. Execution-pack workers, Growth analysis,
Customer Voice analysis, dry-run task workers, Chief-of-Staff handoff
follow-ups, and live AI worker results all use the same contract path.

The live AI worker OpenAI Responses schema was extended to request a nested
business decision object in strict JSON. The runtime still enriches and locks
the final contract itself, so live model output can help with judgement while
the system keeps ownership of approvals, hard stops, and external-action
controls.

Dashboard changes: task and worker-run inspectors now show the business
decision block directly: Money move, Buyer, Problem, Offer, Channel, Evidence,
Risk, Success measure, Stop/change rule, and Review control. The worker trace
label `contract_checked` is rendered as "Business decision ready" rather than
raw backend wording.

This follows the official OpenAI agent guidance used for this build: keep
agents narrow and explicit, prefer structured outputs for downstream
reliability, use guardrails and human approval around side-effect actions, and
evaluate/traces runs so model output quality is observable rather than assumed.

Verification: `node --check` passed for `src/runtime/ai-team.js`,
`src/runtime/agent-runner.js`, `src/adapters/live-ai-worker.js`, and
`public/app.js`. `npm.cmd test` passed 39/39 tests, including dry-run worker
contract assertions, approved handoff follow-up contract assertions, protected
execution-pack/result workers through the shared evaluator, and a strict
OpenAI Responses live-worker schema assertion for the nested business decision.
An isolated dashboard ran on `http://127.0.0.1:5086/` with a temporary SQLite
database. `/api/health` returned ok in dry-run mode with live research and live
workers correctly blocked for missing credentials/flags. Browser QA created a
digital-product workflow through the command box, ran the System Check button,
confirmed the generated workflow reached review state with 11 worker runs,
11 contract traces, 11 passed quality checks, and no missing contract fields.
The AI Team tab showed 11 ready workers and 11 checks, and the task/worker-run
inspectors showed the new decision fields in plain language with external
actions locked. Checked raw phrases `monitor.completed`,
`scheduler.job.completed`, `dry-run active`, and `approval gate` were not
visible in the inspected UI surfaces. Browser warnings/errors were empty.
Screenshot artifact:
`output/playwright/ai-team-decision-contract-qa.png`.

### 2026-07-07 - Specialist Live Worker Routing Added

The live AI worker request rail now routes to a named registered specialist
instead of treating every live test as a generic Chief-of-Staff run. Requested
workers are normalized against the AI Team registry, aliases are accepted, and
explicit unknown worker names are rejected so the system does not silently run
the wrong worker.

Specialist identity now stays attached across the whole protected path: task
agent, task payload, approval payload, spend-gate metadata, provider-blocked
result, live run metadata, OpenAI request metadata, handoff records, and
dashboard inspector state. This matters because the operator needs to know
which worker is asking for approval, what commercial job it owns, and which
output contract will be judged.

Dashboard change: selecting an AI Team worker now exposes a Request Live Test
action for that specific worker. The approval inspector shows the worker in
plain language, for example "Demand Validator", with Approve / Request Changes
/ Deny controls next to the reason and risk. The request path keeps the default
protected mode: no model call or spend happens unless the approval, provider
credentials, live-model flag, adapter readiness, and budget checks all pass.

This continues the official OpenAI agent-building pattern already adopted in
the runtime: keep agents narrow, define their instructions and output contracts,
put validation and approvals beside side-effect/model-spend calls, preserve run
state for resumption, and use traces/evals so worker quality can be improved
rather than assumed.

Verification: `node --check` passed for `src/runtime/live-ai-workers.js`,
`src/runtime/ai-team.js`, `src/runtime/spend-gate.js`, and `public/app.js`.
`npm.cmd test` passed 39/39 tests. An isolated dashboard ran on
`http://127.0.0.1:5087/` with a temporary SQLite database. `/api/health`
returned ok in dry-run mode with live research and live workers correctly
blocked for missing credentials/flags. Browser QA created a digital-product
workflow through the command box, selected Demand Validator in the AI Team tab,
requested a live test, confirmed the approval queue and inspector showed
Worker: Demand Validator with plain-language decision controls, ran System
Check, confirmed Run Next Task refused to bypass the pending approval, ran
Check Schedule, and recorded zero browser warnings/errors. Screenshot artifact:
`output/playwright/specialist-live-worker-routing-qa.png`.

### 2026-07-07 - Agent Workbench Readiness Layer Added

Added the Agent Workbench as the promotion gate between "a worker exists" and
"a worker is ready for a capped live model test." The runtime now has durable
`agent_eval_datasets` and `agent_eval_cases` tables. Each registered AI worker
gets an active readiness dataset and a baseline contract/safety case generated
from its input/output contract, approval policy, and eval criteria.

The new Workbench state is exposed through `aiTeam.workbench`,
`agentWorkbench`, and `GET /api/agent-workbench`. It computes each worker's
readiness from definition completeness, dataset/case coverage, protected
dry-run proof, trace/eval evidence, approval policy, live provider readiness,
pending live approvals, live model-call records, cost evidence, and dry-run
versus live comparison. The status is intentionally operator-facing:
"Needs dry-run proof", "Ready after setup", "Ready for capped live test", or
"Live-tested", rather than raw backend state names.

Dashboard changes: the AI Team tab now starts with an Agent Workbench summary,
worker cards show readiness score/status, and the worker inspector shows the
readiness checklist, protected-run proof, live comparison, provider blocker,
next safe action, and Request Live Test button. A worker can request a live
test only after protected proof, trace review, dataset coverage, and approval
policy are present; provider credentials and the live-model flag still remain
hard gates before any spend or model execution.

This follows the current OpenAI agent guidance used in this build: define
focused agents with clear ownership and structured outputs, pause and resume
human-reviewed actions through approval state, start debugging with traces, and
move toward datasets/eval runs when good behavior needs to be repeatable.

Verification: `node --check` passed for `src/runtime/agent-workbench.js`,
`src/runtime/state.js`, `src/server.js`, and `public/app.js`. `npm.cmd test`
passed 40/40 tests. New coverage proves seeded eval datasets/cases, Workbench
readiness from protected worker evidence, and live-worker comparison after a
stubbed OpenAI Responses run. An isolated dashboard ran on
`http://127.0.0.1:5088/` with a temporary SQLite database. `/api/health`
returned ok in dry-run mode with live workers correctly blocked for missing
credentials/flags. Browser QA confirmed the AI Team tab initially showed
0 dry-run-proven workers and 11 test cases, then created and ran a
digital-product workflow through the UI; the Workbench updated to 10 dry-run
proven workers and Demand Validator at "Ready after setup" with 90% readiness.
The Demand Validator inspector showed dry-run proof passed at 100/100, no live
comparison yet, provider setup blocked, and a pending Demand Validator live
approval after Request Live Test. Browser warnings/errors were empty, and the
checked backend phrases were not visible in the rendered UI. Screenshot
artifact: `output/playwright/agent-workbench-qa.png`.

### 2026-07-07 - AI Worker Tool Policy Registry Added

Added a durable tool-permission layer for the AI Team. The runtime now creates
`agent_tools` and `agent_tool_assignments` records that map every worker tool
to a business-safe permission state: protected internal use, approval-controlled
live use, or locked hard-stop. Tool records capture risk level, approval scope,
provider capability, live flag, spend possibility, external-action status,
adapter links, and plain-language descriptions.

This turns worker tool names from loose labels into runtime-owned controls.
Demand Validator can read runtime state and local deliverables, but live
research sits behind the Research Adapter approval path. Product Builder can
prepare local review packs, but the Digital Product Adapter remains approval
controlled. Marketplace publishing, supplier publishing, account actions,
payments, refunds, disputes, unsupported claims, legal determinations, autopilot
promotion, and spend increases are registered as locked tools and are not
assigned to active workers.

The Agent Workbench now includes tool permissions as a readiness requirement.
The dashboard AI Team view shows controlled-tool counts and locked-action
counts, worker cards summarize each worker's tool permission state, and the
worker inspector shows what a worker can use safely, what needs operator
approval, and what is locked. Worker run metadata and traces now include the
worker tool-policy state so a completed run records which controls were checked
before the worker acted.

This follows the official OpenAI agent-building guidance used for this system:
give agents explicit tools and instructions, put approvals and guardrails close
to sensitive tool calls, and preserve trace/eval evidence so agent behavior can
be reviewed and improved rather than assumed.

Verification: `node --check` passed for `src/runtime/agent-tools.js`,
`src/runtime/agent-runner.js`, `src/runtime/agent-workbench.js`,
`src/runtime/state.js`, `src/server.js`, and `public/app.js`. `npm.cmd test`
passed 41/41 tests. New coverage proves seeded tool-policy state, Demand
Validator's approval-gated Research Adapter, Product Builder's approval-gated
Digital Product Adapter, locked marketplace publishing with zero active
assignments, Workbench tool-permission readiness, and live-worker run metadata
that records the worker tool policy.

### 2026-07-07 - AI Worker Tool Invocation Gate Added

Added an execution-time tool gate on top of the worker tool registry. The
runtime now creates `agent_tool_invocations` records for worker tool attempts
and classifies each attempt as allowed, approval-required, or blocked. Protected
use of approval-controlled tools can proceed only when the tool has a safe
no-side-effect path; live use requires an approved operator decision; locked,
unassigned, and unknown tools are blocked and traceable.

The new gate lives in `src/runtime/agent-tool-gate.js` and is exposed through
`aiTeam.toolGate`, `agentToolGate`, and `GET /api/agent-tool-gate`. The agent
runner now checks tool access when workers read runtime state, use the Research
Adapter, and update local deliverables. Tool decisions are recorded in the
invocation ledger, agent traces, events, and run metadata so a worker run shows
which action surfaces were checked before it proceeded.

Dashboard changes: the AI Team Workbench summary now includes tool-check and
blocked-check counts. Worker-run inspectors show the tool checks attached to
that run, including whether the call was allowed, needed approval, or was
blocked. The wording remains operator-facing: protected proof, tool checks,
locked tools, and approval-controlled live use rather than backend syntax.

This follows the official OpenAI agent guidance used for this build: tools are
the agent action surface, approval should be evaluated before sensitive tool
execution, tool guardrails are the right place to validate or block function
tool calls, and traces should preserve tool-call/guardrail behavior for review.

Verification: `node --check` passed for `src/runtime/agent-tool-gate.js`,
`src/runtime/agent-runner.js`, `src/runtime/state.js`, `src/server.js`, and
`public/app.js`. `npm.cmd test` passed 42/42 tests. New coverage proves allowed
protected runtime-state use, protected Research Adapter use, live Research
Adapter approval creation, approved live Research Adapter use, hard-stop
blocking for Marketplace Publishing, unknown-tool blocking with a review
placeholder, tool traces, and gate metrics.

Browser/runtime proof: a temporary runtime on `PORT=5091` loaded the dashboard
in the in-app browser, ran the system check, accepted a protected digital-product
operator instruction, and produced 11 completed protected worker runs with 12
allowed worker tool checks and 0 blocked checks. `GET /api/health` returned
ready local runtime state with live research/workers still correctly blocked by
missing credentials and live flags. The AI Team tab showed 12 tool checks and 0
blocked checks in operator-facing language, and opening the latest Chief of
Staff run showed the inspector `Tool Checks` panel with Runtime State and Local
Deliverables checks plus readable trace events. Browser console warnings/errors
were empty. Visual screenshot capture was attempted through the in-app browser
and Windows screen capture, but both produced blank images in this desktop
environment, so no screenshot artifact was retained.

### 2026-07-07 - AI Worker Tool Approval Resume Added

Added durable pause/resume behavior for approval-gated AI worker tools. When a
worker asks for a live approval-controlled tool, the tool gate now throws a
typed approval-required interruption instead of letting the worker task look
like a normal failure. The runtime records the approval, original tool
invocation, worker run, task, workflow, and plain-language resume instructions.

Approving the tool now marks the original tool invocation as approved for live
use and queues the paused worker task to continue. Requesting changes or denying
marks the invocation as stopped, records the operator decision in trace/events,
and stops the linked worker step without any live tool call or spend. The agent
runner records paused runs as `waiting_approval`, the orchestrator preserves the
approval id on the blocked task, and the dashboard approval inspector shows what
will happen if the operator approves, requests changes, or denies.

This keeps the AI Team aligned with the official OpenAI agent-building guidance
used here: tools are the worker action surface, sensitive tool calls should be
approval-gated, paused work should resume from stored run state, guardrails
belong close to tool execution, and traces should preserve model, tool,
guardrail, handoff, and custom workflow events.

Verification: `node --check` passed for `src/runtime/agent-tool-gate.js`,
`src/runtime/approvals.js`, `src/runtime/orchestrator.js`,
`src/runtime/agent-runner.js`, and `public/app.js`. A focused live-worker
regression test passed after fixing a success-path metadata bug. `npm.cmd test`
passed 43/43 tests. New coverage proves approve/resume, request-changes/stop,
and deny/stop paths for approval-gated worker tool work, plus trace events for
approved, changes-requested, and denied tool decisions.

Browser/runtime proof: the existing `5051` process was still serving an older
runtime snapshot, so a fresh current-code server was started on
`http://127.0.0.1:5094/`. `/api/health` returned ok in dry-run mode with live
research and live AI workers correctly blocked for missing credentials/flags.
The dashboard created a protected digital-product work plan from the command
box and ran the safe worker chain with no spend or external action. The AI Team
tab then showed 11 ready workers, 10 protected proofs, 10 ready-after-setup
workers, 11 test cases, 39 controlled tools, 17 locked actions, 12 tool checks,
and 0 blocked checks. Browser console warnings/errors were empty, and the
checked raw backend phrases (`approval_required`, `waiting_approval`,
`run_paused`, `monitor.completed`, `scheduler.job.completed`) were not visible
in the rendered UI.

### 2026-07-07 - AI Team Startup Bootstrap Hardened

Made the AI Team foundation explicit at runtime startup. `createRuntime()` and
`createApp()` now run an idempotent foundation bootstrap that refreshes
integration records, ensures AI Team worker definitions, ensures worker tool
permissions, ensures Workbench eval datasets/cases, ensures scheduler jobs, and
ensures scorecards. This prevents an existing initialized database from showing
an empty AI Team view just because the database was created before the worker
foundation existed.

The integration registry now also owns the durable Codex, Digital Product
Publishing, and guarded Etsy records, matching the connection surface used by
the worker tool registry and monitor. That keeps startup from depending on the
first-run seed path for integration rows referenced by controlled tools.

Verification: `node --check` passed for `src/server.js` and
`src/adapters/registry.js`. A new regression test proves that an already
initialized legacy database with no AI Team rows is backfilled on startup with
11 workers, 11 eval datasets, 11 eval cases, at least 30 controlled tools,
active tool assignments, and the required connection records. `npm.cmd test`
passed 44/44 tests.

Browser/runtime proof: the current-code server was restarted on
`http://127.0.0.1:5094/`. `/api/health` returned ok in dry-run mode, with live
research and live AI workers still correctly blocked by missing credentials and
live flags. Direct database proof after startup showed 11 workers, 39 tools,
11 eval datasets, and 11 integrations before any special dashboard action. In
the real browser, the AI Team tab showed Agent Workbench, 11 ready workers,
10 protected proofs, 11 test cases, 39 controlled tools, 12 tool checks, and no
empty-worker state. Browser console warnings/errors were empty, and raw backend
phrases stayed out of the rendered UI.

### 2026-07-07 - Live Research Now Feeds Next-Test Candidates

Connected completed live research to the commercial next-test loop. A successful
live research run now creates exactly one source-linked commercial brief, three
ranked approval-safe test candidates, a commercial event, and an agent trace so
fresh evidence becomes a dashboard Money Move instead of a buried research
record. The bridge is idempotent: rerunning the same research run returns the
existing brief and candidates instead of creating duplicate recommendations.

The implementation lives in `src/runtime/research-to-experiment.js` and
`src/runtime/agent-runner.js`. It only converts completed live research statuses,
preserves source count, verdict, confidence, recommendation, provider/model
metadata, and keeps every generated test dry-run/manual until the operator
chooses to promote or execute it. Dry-run research remains a request for better
evidence, not commercial proof.

This follows the official agent guidance used for the AI Team build: focused
specialists, manager-owned orchestration, tools as bounded capabilities,
human review before sensitive actions, traceable runs, and eval-oriented
improvement loops.

Verification: `node --check` passed for `src/runtime/research-to-experiment.js`,
`src/runtime/agent-runner.js`, and `test/runtime.test.js`. `npm.cmd test` passed
45/45 tests. New coverage proves direct idempotent live-research conversion,
automatic end-to-end conversion from the approved live research worker path,
source-linked candidate metadata, dashboard Money Move visibility, and the
`research_test_candidates_created` trace event.

### 2026-07-07 - Execution Packs Now Include Finance Worker Proof

Added the Finance and Unit Economics Agent to execution-pack generation. A
ready manual market-contact pack now creates protected AI Team records:
Product Builder for scope, Copy and Conversion for offer copy, Finance and Unit
Economics for price/margin/cap/break-even/spend safety, and Distribution for
the manual channel plan and Chief-of-Staff handoff. This makes the pack a fuller
business-worker bundle instead of only a copy/channel artifact.

The Finance worker remains protected and no-spend. It records price, estimated
gross margin, margin percentage, cost cap, break-even sales, financial risk,
decision signal, worker contract output, trace, eval result, and locked
external-action state in the agent ledger.

Verification: `node --check` passed for `src/runtime/test-execution-pack.js`
and `test/runtime.test.js`. `npm.cmd test` passed 45/45 tests. Updated coverage
proves execution packs store a Finance worker run, unit-economics metadata,
business-decision lock state, and no extra handoff beyond the existing
Distribution-to-Chief-of-Staff decision gate. Runtime proof on port 5097
created a fresh protected digital-product pack with four worker records,
including `finance_analyst` at eval score 100 with $49.00 price and 92%
estimated margin. Browser proof on the AI Team tab showed Finance and Unit
Economics in ordinary operator language, with no warning/error console logs and
no raw backend status labels leaking into the dashboard.

### 2026-07-07 - Chief-of-Staff Execution-Pack Decision Packet Added

Execution-pack generation now creates a Chief-of-Staff manager run after the
Product, Copy and Conversion, Finance and Unit Economics, and Distribution
specialists complete their protected checks. The manager run writes a
`jarvis_chief_of_staff_decision_packet_v1` packet into pack metadata with the
operator summary, money move, approve/request-changes/deny decision, buyer,
problem, offer, channel, price, estimated margin, cost cap, break-even, evidence,
hard stops, allowed operator actions, worker run ids, handoff id, and continuous
improvement loop.

The Commercial Brain now prefers that packet for the ready execution-pack Money
Move, and the dashboard shows the packet inside the pack inspector before the
long copy/tracking details. If the related Chief-of-Staff handoff is waiting,
the overview card and pack inspector show Approve, Request Changes, and Deny
buttons from the same decision surface.

This tightens the official agent-building pattern used in this repo: specialist
workers produce bounded outputs, the manager compresses them into an
operator-facing decision, the handoff remains a human-review boundary, traces
preserve the path, and evals check the manager output contract.

Verification: `node --check` passed for `src/runtime/test-execution-pack.js`,
`src/runtime/commercial-brain.js`, `public/app.js`, and `test/runtime.test.js`.
`npm.cmd test` passed 45/45 tests. New coverage proves execution packs create
the Chief-of-Staff run, packet, handoff link, worker-run links, no-spend
economics, Commercial Brain packet source, and API-visible packet handoff id.
Runtime proof used an isolated dashboard server on port 5099 with a fresh
workspace database. Health returned ok, a new no-spend digital-product pack
created five worker records, the packet was linked to the waiting handoff, and
the Money Move source was `chief_of_staff_packet`. Browser proof confirmed the
overview showed the packet title, money move, Open Pack, and Approve / Request
Changes / Deny controls; opening the pack inspector showed the Chief-of-Staff
packet, economics, locked actions, and the same decision buttons with no
warning/error console logs and no raw backend labels leaking into the UI.

### 2026-07-07 - Chief-of-Staff Outcome Decision Packets Added

Execution-pack outcomes now create a Chief-of-Staff manager packet after the
specialist result analysis. When the operator records a result, marks no
response, or records a buyer reply/objection, the existing Growth Analyst or
Customer Voice worker still analyzes the signal first. Chief of Staff then
compresses that specialist output into a
`jarvis_chief_of_staff_outcome_packet_v1` packet with the operator summary,
money move, continue/revise/pause/stop decision, actual result, learning,
improvement, evidence, risk, hard stops, linked worker run ids, and the waiting
handoff id.

The packet is written back onto the execution pack, the learning cycle, and the
result or feedback row. The Commercial Brain now prefers that packet for the
learning Money Move, so the Overview shows the next business decision instead
of asking the operator to interpret raw metrics. The Results-side inspectors
now surface the Chief-of-Staff packet and, when a handoff is waiting, show the
Approve, Request Changes, and Deny buttons on the same card.

This follows the official agent-building pattern used for the AI Team build:
Growth and Customer Voice stay as bounded specialists, Chief of Staff owns the
operator-facing synthesis, human-review handoffs remain durable/resumable, and
the trace/eval path records what happened before another action is taken.

Verification: `node --check` passed for `src/runtime/test-execution-pack.js`,
`src/runtime/commercial-brain.js`, `public/app.js`, and `test/runtime.test.js`.
`npm.cmd test` passed 45/45 tests. New coverage proves outcome packets are
created for no-response results and buyer replies, linked to Growth/Customer
Voice runs, linked to the waiting Chief-of-Staff handoff, stored on learning and
result/feedback records, and preferred by Commercial Brain as
`chief_of_staff_outcome_packet`.

Runtime proof used an isolated dashboard server on port 5100 with a fresh
workspace database. Health returned ok in dry-run mode, a protected
digital-product execution pack was created, a no-response outcome generated a
`jarvis_chief_of_staff_outcome_packet_v1` packet, and the Money Move source was
`chief_of_staff_outcome_packet`. Browser proof loaded the Results tab, selected
the learning cycle, and confirmed the inspector showed the Chief-of-Staff
packet, money move, actual result, learning, improvement, locked actions, and
Approve / Request Changes / Deny controls with no warning/error console logs and
no raw backend labels leaking into the user-facing packet.

### 2026-07-07 - AI Team Promotion Gate Added

Added a worker promotion decision layer inside the Agent Workbench. Every AI
worker now gets a `jarvis_agent_promotion_gate_v1` decision that compares
protected proof, live comparison output, trace coverage, eval score, cost cap,
tool permissions, hard stops, provider readiness, and pending approvals before
the system recommends wider use.

The gate deliberately uses operator language instead of backend labels. A worker
can be shown as needing protected proof, needing provider setup, waiting for a
live-test approval, ready for one capped live comparison, failed and needing
review, or ready only for narrow capped live use. Even when a worker passes, the
recommendation keeps publishing, customer contact, paid spend, account actions,
legal decisions, and finance actions behind separate approval.

Dashboard changes: the AI Team Workbench summary now counts workers that are
narrow live-ready and workers needing promotion review. Worker cards show the
promotion recommendation, and the worker inspector shows evidence, risks,
comparison metrics, allowed next actions, and checklist requirements beside the
existing protected-run and live-run proof.

This strengthens the official OpenAI agent principles already guiding the build:
narrow specialist agents, manager-style orchestration/handoffs, human review for
sensitive actions, durable state/results, traces, and evals before broader live
execution.

### 2026-07-07 - Agent Workbench Protected Proof Drill Added

Added a first-class protected proof drill for the AI Team. Selecting a worker in
the dashboard can now run `Run Protected Proof`, which creates a normal
Workbench workflow, command, task, worker run, trace events, eval result, and
promotion-gate update for that specific worker.

The proof drill stays inside protected mode: no live model call, external tool,
publishing, customer contact, account action, money movement, or spend is
allowed. It exists to answer a practical operator question: can this worker
produce a useful buyer/problem/offer/channel decision, evidence, risk, next
action, stop rule, and learning loop before we even consider a capped live
comparison?

Runtime changes:
- `queueAgentWorkbenchProof()` creates the durable proof workflow/task.
- `workbench_proof` is now a protected agent-runner policy and output template.
- `/api/agent-workbench/:id/proof-run` queues and, by default, runs the proof.
- The AI Team worker cards and inspector expose Run Proof / Run Protected Proof.

This makes the AI Team more commandable: the operator no longer has to invent a
full business workflow just to prove one specialist worker. The result still
uses the same official-agent-aligned rails already adopted here: narrow worker
instructions, tool policy, approval locks, stateful results, traces, evals, and
human-review promotion before live execution.

### 2026-07-07 - Protected AI Team Drill Added

Added a protected team-level proof drill to the Agent Workbench. The dashboard
now has a `Run Team Drill` action that queues the core digital-product AI crew
under one normal workflow: Chief of Staff, Opportunity Scout, Demand Validator,
Offer Architect, Product Builder, Copy and Conversion, Distribution, Finance and
Unit Economics, Customer Voice, Growth Analyst, and Quality Reviewer.

The drill is deliberately not live autonomy. Each worker runs as a normal
`workbench_proof` task with the same protected runner policy, business-decision
contract, trace events, eval checks, zero-spend cost evidence, tool controls,
and promotion-gate updates used by the single-worker proof path. No live model
call, external contact, publishing, account action, money movement, legal or
compliance decision, or spend is allowed.

Runtime changes:
- `queueAgentWorkbenchProofSuite()` creates the team workflow, command, and
  worker proof tasks.
- `/api/agent-workbench/proof-suite` queues and, by default, safely runs the
  protected drill until review.
- The AI Team dashboard Workbench summary exposes `Run Team Drill`.

This moves the AI Team from isolated worker proof toward a real operating crew:
the operator can now ask, "Can this business crew produce useful protected
decision evidence together?" before considering any capped live comparison.

Verification: `node --check` passed for `src/runtime/agent-workbench.js`,
`src/server.js`, `public/app.js`, and `test/runtime.test.js`. `npm.cmd test`
passed 49/49 tests. New coverage proves direct runtime team-drill queue/run,
HTTP API team-drill execution, protected worker traces/evals, zero actual spend,
workflow review completion, and promotion-gate updates for the selected crew.
Browser proof on an isolated runtime at `http://127.0.0.1:5104/` clicked the
dashboard `Run Team Drill` button, completed 11/11 protected worker proof tasks
under one `agent_workbench_team_proof` workflow, showed 11 protected proofs,
11 ready-after-setup workers, 11 tool checks, 0 blocked tool checks, no raw
backend labels in the rendered UI, and no console warnings/errors. Screenshot:
`output/playwright/ai-team-protected-team-drill.png`.

### 2026-07-07 - Chief-of-Staff Team Drill Summary Added

Added a manager summary after the protected AI Team drill completes. When all
team proof tasks finish, the runtime now creates a protected Chief-of-Staff
`team_drill_summary` run, stores a `jarvis_agent_team_drill_summary_v1` packet
on the workflow metadata, records a durable event/message, and leaves the drill
ready for operator review.

The summary is intentionally operator-facing. It shows workers passed, actual
spend, blockers, hard stops, money move, next decision, worker proof highlights,
and continuous-improvement learning. The workflow inspector surfaces the packet
above the general decision panel with direct controls to prepare one capped live
worker test, generate a review pack, or rerun the protected drill. The default
visible team name now reads `Digital product AI team` instead of a machine-like
hyphenated label.

Runtime changes:
- `recordAgentWorkbenchTeamSummary()` compresses completed team proof tasks into
  one Chief-of-Staff packet and is called automatically when the team drill
  workflow reaches review.
- The team proof tests now assert the summary schema, Chief-of-Staff run,
  event, message, worker pass counts, and zero actual spend.
- The dashboard maps the new event/trace labels to ordinary language and shows
  the Chief-of-Staff summary in the workflow inspector.

Verification: `node --check` passed for `src/runtime/agent-workbench.js`,
`src/runtime/orchestrator.js`, `public/app.js`, and `test/runtime.test.js`.
`npm.cmd test` passed 49/49 tests after the final changes. Health check on an
isolated runtime at `http://127.0.0.1:5106/` returned `ok: true`, dry-run mode,
and correctly blocked live worker execution until OpenAI credentials and the
live flag are configured. Browser proof clicked `AI Team` -> `Run Team Drill`,
confirmed the inspector showed `Chief of Staff summary`, `11/11 workers passed`,
`$0 actual spend`, plain-language blockers, the three decision controls, no raw
backend labels, and no console warnings/errors. Screenshot:
`output/playwright/ai-team-drill-summary-final.png`.

### 2026-07-08 - Workbench Live Comparison Request Added

Added the first first-class Workbench live-comparison request. A completed
protected AI Team drill can now prepare one capped specialist live-worker
comparison from the Chief-of-Staff summary, instead of sending the operator to
a generic live-worker request.

The Workbench chooses the relevant specialist from the protected proof
(`Demand Validator` by default when present), carries protected proof evidence
into the live spend approval, stores the pending comparison back on the
workflow's team summary, records a Workbench event, and still leaves execution
blocked until both explicit approval and provider readiness pass. No live model
call or spend occurs during request preparation.

Runtime changes:
- `requestAgentWorkbenchLiveComparison()` creates the comparison request from a
  protected team-drill summary and calls the existing approval-gated live-worker
  request rail with proof evidence attached.
- Live-worker request payloads and spend approvals now preserve
  `comparisonSource`, `protectedEvidence`, and an expected metric so the
  operator can judge live output against protected proof.
- `/api/agent-workbench/:id/live-comparison` exposes the Workbench comparison
  path for the dashboard.
- The Chief-of-Staff summary button now says `Prepare Live Comparison` and
  updates the summary with the selected worker, task, approval, cost cap, and
  provider/model details.

Verification: `node --check` passed for `src/runtime/agent-workbench.js`,
`src/runtime/live-ai-workers.js`, `src/runtime/spend-gate.js`,
`src/server.js`, `public/app.js`, and `test/runtime.test.js`. `npm.cmd test`
passed 50/50 tests. Health check on an isolated runtime at
`http://127.0.0.1:5107/` returned `ok: true`, dry-run mode, and correctly
blocked live worker execution until OpenAI credentials and the live flag are
configured. Browser proof clicked `AI Team` -> `Run Team Drill` -> `Prepare
Live Comparison`, confirmed a pending `Demand Validator` approval with
protected proof evidence attached, no live spend, no raw backend labels in the
rendered UI, and no console warnings/errors. Screenshot:
`output/playwright/workbench-live-comparison.png`.

### 2026-07-08 - Pre-OpenAI Readiness Surface Added

Added a local pre-OpenAI readiness layer so the system can be taken as far as
possible before connecting live OpenAI credentials or enabling live model
execution. The new runtime state reports whether the AI Team foundation is
ready before provider setup: registered workers, worker contracts and eval
cases, tool controls, protected worker proof, team-drill summary, full crew
coverage, capped live-comparison request, operator decision gate, zero actual
spend, provider credentials, live model switch, adapter state, and budget room.

Dashboard changes:
- The AI Team view now includes a `Pre-OpenAI readiness` panel above the live
  worker provider panel.
- The panel uses ordinary operator language: ready before OpenAI setup, needs
  team drill, needs comparison request, waiting for your decision, OpenAI key
  not connected, live model switch off, and actual spend.
- The panel gives the next safe action directly, such as running the team drill,
  preparing a capped live comparison, or reviewing the pending decision. It does
  not connect credentials, enable live models, or run any spend.

Runtime changes:
- `src/runtime/pre-openai-readiness.js` computes the local foundation state from
  the Agent Workbench, tool policy, live worker readiness, workflows, approvals,
  tasks, costs, model calls, worker runs, and events.
- `getDashboardState()` now exposes `preOpenAiReadiness` and AI Team metrics for
  provider gates and local foundation readiness.
- Tests now cover the direct readiness helper and the dashboard state after a
  protected team drill plus capped comparison request. The expected state is
  `ready_before_model_connection`, with OpenAI credentials and the live model
  switch still locked.

Verification: `node --check` passed for
`src/runtime/pre-openai-readiness.js`, `src/runtime/state.js`, and
`public/app.js`. `npm.cmd test` passed 51/51 tests. Health check on an isolated
runtime at `http://127.0.0.1:5109/` returned `ok: true`, dry-run mode, and
live workers correctly blocked for missing OpenAI credentials and live-model
flag. Browser proof clicked `AI Team` -> `Run Team Drill` -> `Prepare Live
Comparison` from the pre-OpenAI readiness panel, confirmed
`ready_before_model_connection`, `11/11` protected worker proofs, one pending
`Demand Validator` capped comparison decision, `$0` actual spend, no raw backend
labels in the UI, and no console warnings/errors. Screenshots:
`output/playwright/pre-openai-readiness-heading.png` and
`output/playwright/pre-openai-readiness-panel.png`. No live model call, OpenAI
credential use, live flag change, external action, or spend occurred.

### 2026-07-08 - Operator Decision Inbox Added

Added a unified operator decision inbox so the pre-model system can make the
operator experience simpler before OpenAI pathways are connected. The inbox
normalizes pending approvals, AI worker handoffs, Workbench live-comparison
requests, commercial money moves, and ready PDF review packs into one
operator-facing queue.

Runtime changes:
- Added `src/runtime/decision-inbox.js` with schema
  `jarvis_operator_decision_inbox_v1`.
- `getDashboardState()` now exposes `decisionInbox` plus
  `metrics.decisionInbox`.
- `GET /api/decision-inbox` now returns the generated operator inbox and its
  metrics directly for future chat, mobile, notification, or lightweight
  control surfaces.
- Live-comparison items use plain operator language: decide whether to allow
  one capped live worker comparison against protected proof. Backend provider
  wording is kept out of the money-move line.
- Inbox items carry evidence, blockers, risk, expected upside, cost cap,
  no-spend state, worker/source links, and direct action descriptors.

Dashboard changes:
- Overview `Decisions Needed` now reads from the decision inbox rather than a
  fragmented approvals-plus-handoffs list.
- The Approvals tab now starts with the inbox summary and card list before the
  historical approval ledger.
- Cards provide direct Approve, Request Changes, Deny, Preview Pack, Open
  Workflow, Generate Pack, Promote Test, and Record Result controls where those
  actions are valid.
- User-facing labels remain ordinary business language such as Decisions
  waiting, Worker handoff, Live comparison, No spend, and capped cost.

Verification: `node --check` passed for `src/runtime/decision-inbox.js`,
`src/runtime/state.js`, `public/app.js`, and `test/runtime.test.js`.
`npm.cmd test` passed 51/51 tests after all code changes. Health check on an
isolated runtime at `http://127.0.0.1:5112/` returned `ok: true`, dry-run mode,
and live workers blocked for missing OpenAI credentials and live-model flag.
Browser proof clicked `AI Team` -> `Run Team Drill` -> `Prepare Live
Comparison` -> `Approvals`, confirmed three operator inbox items, one
`Demand Validator` capped comparison decision, direct Approve / Request Changes
/ Deny controls, no spend occurred, no horizontal overflow after the layout
fix, no raw backend readiness/status codes in visible text, and no console
warnings/errors. Screenshot:
`output/playwright/decision-inbox-final.png`.

### 2026-07-08 - Manual Market Test Cockpit Added

Added a local Manual Market Test Cockpit so the system can be taken further
before OpenAI model pathways are connected. The cockpit turns test options,
promoted tests, execution packs, AI Team handoffs, outcomes, and learning cycles
into one operator-facing market-test surface.

Runtime changes:
- Added `src/runtime/manual-market-cockpit.js` with schema
  `jarvis_manual_market_test_cockpit_v1`.
- `getDashboardState()` now exposes `manualMarketCockpit` plus
  `metrics.manualMarketCockpit`.
- `GET /api/manual-market-cockpit` returns the cockpit directly for future chat,
  mobile, or lightweight control surfaces.
- Cockpit items show the buyer, offer, channel, cost cap, expected upside,
  no-spend state, hard stops, worker summary, latest outcome, and next decision.
- Outcome status stays honest: a pack becomes learning-ready only after a
  linked result, feedback signal, or Chief-of-Staff outcome packet exists.

Dashboard changes:
- Added a `Market Tests` tab with a cockpit focus panel, test-signal metrics,
  ready-test queue, and run sheet.
- Execution-pack cards expose Approve, Request Changes, Deny, Open Pack, Record
  Result, Record Reply, and Mark No Response directly on the card.
- Record Result from a pack opens the Results form already linked to the
  execution pack, so the result updates the pack and Chief-of-Staff learning
  loop instead of creating a detached metric row.
- Long offer/channel text now stays inside the dark cockpit layout, and market
  card buttons remain visible without internal horizontal overflow.

Verification: `node --check` passed for `src/runtime/manual-market-cockpit.js`,
`src/runtime/state.js`, `src/server.js`, `public/app.js`, and
`test/runtime.test.js`. `npm.cmd test` passed 51/51 tests. Health check on an
isolated runtime at `http://127.0.0.1:5113/` returned `ok: true`, dry-run mode,
with live AI workers and live research still blocked. Browser proof used the
in-app browser against the isolated runtime, created a local digital-product
test, promoted it, generated an execution pack, opened `Market Tests`, confirmed
decision-ready approval controls and result/no-response shortcuts, opened the
linked Results form from the cockpit, submitted a safe local result of 42 views,
6 clicks, 2 leads, 1 sale, $24 revenue, $0 spend, and confirmed the cockpit/API
reported 1 result, 1 learning cycle, 1 pack with outcome, and a Chief-of-Staff
next decision. No console warnings/errors were recorded. Screenshots:
`output/playwright/manual-market-cockpit.png`,
`output/playwright/manual-market-result-linked.png`, and
`output/playwright/manual-market-after-result.png`.

### 2026-07-08 - Learning-to-Revised-Test Loop Added

Added a local revision loop after market outcomes. A commercial learning cycle
can now generate the next ranked test options without a model call, using the
Chief-of-Staff outcome packet, actual result, learning, improvement, buyer,
offer, channel, and price context.

Runtime changes:
- Added `createRevisionPlanFromLearning()` to
  `src/runtime/research-to-experiment.js`.
- `POST /api/commercial/learning/:id/revision-plan` creates or reuses a ranked
  revised test plan for a learning cycle.
- Revised briefs and candidates store `sourceLearningId` and
  `sourceExecutionPackId` metadata for traceability and idempotency.
- The path creates normal commercial briefs and test candidates, so existing
  Money Moves, Next Tests, promotion, execution-pack, and result-capture rails
  work without a new pipeline.

Dashboard changes:
- Learning cards, learning inspectors, Money Moves, and post-outcome Market
  Test cards now expose `Create Revised Test`.
- Clicking the control moves the operator to `Next Tests`, selects the
  recommended revised candidate, and shows normal Promote Test controls.

Verification: `node --check` passed for
`src/runtime/research-to-experiment.js`,
`src/runtime/manual-market-cockpit.js`, `src/server.js`, `public/app.js`, and
`test/runtime.test.js`. `npm.cmd test` passed 52/52 tests. Health check on an
isolated runtime at `http://127.0.0.1:5114/` returned `ok: true`, dry-run mode,
with live AI workers and live research still blocked. Browser proof used the
same isolated market-result database, clicked `Market Tests` -> `Create Revised
Test`, confirmed the dashboard moved to `Next Tests`, selected the recommended
revised option, and confirmed the API had one source-linked revised brief and
three source-linked revised candidates. No console warnings/errors were
recorded. Screenshot:
`output/playwright/manual-market-revised-tests.png`.

### 2026-07-08 - Worker Operating Briefs Added

Added operator-facing operating briefs for the AI Team before connecting more
OpenAI model pathways. The briefs are generated from the existing durable worker
definitions, tool permissions, Workbench proof state, approval rules, handoff
targets, and continuous-improvement contract. They are not a second prompt
system; they are a readable control layer over the runtime truth.

Runtime changes:
- Added `src/runtime/agent-operating-briefs.js` with
  `jarvis_agent_operating_briefs_v1`.
- Dashboard state now includes `agentOperatingBriefs` and
  `aiTeam.operatingBriefs`.
- Added `GET /api/agent-operating-briefs` so later provider setup can consume
  the same worker briefs the operator sees.
- Metrics now record how many worker briefs are ready versus the registered AI
  Team.

Dashboard changes:
- AI Team now shows a Worker Operating Briefs summary beside Workbench and
  pre-OpenAI readiness.
- Worker cards show the first plain-language ownership duty.
- The worker inspector now shows the full operating brief: owns, must produce,
  evidence standard, locked actions, safe tools, approval-controlled tools,
  proof status, next safe action, and learning rule.

Verification: `node --check` passed for
`src/runtime/agent-operating-briefs.js`, `src/runtime/state.js`,
`src/server.js`, `public/app.js`, and `test/runtime.test.js`. `npm.cmd test`
passed 53/53 tests. Health check on an isolated runtime at
`http://127.0.0.1:5120/` returned `ok: true`. The
`/api/agent-operating-briefs` endpoint returned
`jarvis_agent_operating_briefs_v1`, `ready`, and 11/11 complete worker briefs.
Browser proof opened the AI Team tab, selected Demand Validator, confirmed the
Worker Operating Briefs summary, confirmed the inspector showed safe tools,
approval-required Research Adapter, hard stops, protected proof, and next safe
action, and confirmed no console warnings/errors, no page horizontal overflow,
no roster horizontal overflow, and no brief horizontal overflow.

### 2026-07-08 - Protected Worker Playbooks Added

Added protected local playbooks for the AI Team before connecting more OpenAI
model pathways. Each playbook defines the worker's trigger, first move,
protected steps, evidence captured, handoff, success metric, stop rule, model
connection rule, and operator controls.

Runtime changes:
- Added `src/runtime/agent-playbooks.js` with `jarvis_agent_playbooks_v1`.
- Dashboard state now includes `agentPlaybooks` and `aiTeam.playbooks`.
- Added `GET /api/agent-playbooks` for dashboard and future worker setup use.
- Metrics now record ready playbooks versus registered workers.

Dashboard changes:
- AI Team now shows a Protected Worker Playbooks summary beside Workbench,
  operating briefs, and pre-OpenAI readiness.
- Worker cards show the first protected playbook move.
- The worker inspector now shows the full playbook: use case, first move,
  protected steps, evidence captured, handoff, success metric, stop rule, model
  connection rule, and controls.

Verification: `node --check` passed for `src/runtime/agent-playbooks.js`,
`src/runtime/state.js`, `src/server.js`, `public/app.js`, and
`test/runtime.test.js`. `npm.cmd test` passed 54/54 tests. Health check on an
isolated runtime at `http://127.0.0.1:5120/` returned `ok: true`. The
`/api/agent-playbooks` endpoint returned `jarvis_agent_playbooks_v1`, `ready`,
and 11/11 ready worker playbooks. Browser proof opened the AI Team tab,
selected Distribution Agent, confirmed the Protected Worker Playbooks summary,
confirmed the inspector playbook showed use case, protected steps including the
manual run sheet, stop rule, model-connection rule, and confirmed no console
warnings/errors, no page horizontal overflow, no roster horizontal overflow,
and no playbook-panel horizontal overflow.

### 2026-07-08 - Protected Playbook Rehearsals Added

Made protected worker playbooks executable before OpenAI model connection. A
playbook rehearsal queues a normal protected Workbench proof for one worker, but
adds the playbook contract and the current manual market-test context to the
workflow, command, and task metadata.

Runtime changes:
- Added `queueAgentPlaybookRehearsal()` in `src/runtime/agent-playbooks.js`.
- Added `POST /api/agent-playbooks/:id/rehearsal`.
- Rehearsal state now appears in `agentPlaybooks.summary`,
  `aiTeam.playbooks.summary`, each worker playbook, and each worker's latest
  rehearsal.
- Rehearsals prefer the latest execution pack as manual market-test context,
  then fall back to the latest test candidate, then to a protected digital
  product default.
- Each rehearsal records a normal workflow, command, task, worker run, trace,
  eval, cost, event, and ready-for-review state with no live model call, spend,
  publishing, customer contact, or account action.

Dashboard changes:
- Worker cards now include `Run Rehearsal`.
- The worker inspector now includes `Run Playbook Rehearsal`.
- Playbook summary metrics now show rehearsals passed, total rehearsals, and
  rehearsal spend.
- Worker cards and inspector show latest rehearsal status after a run.

Verification: `node --check` passed for `src/runtime/agent-playbooks.js`,
`src/server.js`, `src/runtime/state.js`, `public/app.js`, and
`test/runtime.test.js`. Focused Node test for direct/API rehearsal paths passed
2/2. `npm.cmd test` passed 56/56 tests. Health check on an isolated runtime at
`http://127.0.0.1:5121/` returned `ok: true`. The rehearsal API completed a
Distribution Agent playbook rehearsal with eval `passed`, 1/1 rehearsals passed,
and 0 actual spend. Browser proof opened the AI Team tab, selected Distribution
Agent, confirmed existing rehearsal state, clicked `Run Playbook Rehearsal`,
confirmed the dashboard updated to 2/2 rehearsals passed with `$0 rehearsal
spend`, confirmed the inspector showed latest rehearsal `Complete - Passed -
$0`, confirmed the toast `Distribution Agent rehearsal Complete.`, and
confirmed no console warnings/errors, no page horizontal overflow, no roster
horizontal overflow, and no playbook-panel horizontal overflow.

### 2026-07-08 - Playbook Rehearsal Added to Pre-OpenAI Readiness

Tightened the pre-OpenAI foundation gate so the system cannot report the AI
Team foundation as ready until at least one protected worker playbook rehearsal
has passed with zero spend. This keeps the local foundation honest: a team drill
shows workers can produce protected proof together, while a rehearsal shows a
worker can follow its actual operating playbook against the manual market-test
queue.

Runtime changes:
- `getPreOpenAiReadinessState()` now accepts/loads `agentPlaybooks`.
- Pre-OpenAI readiness now reports playbook rehearsal count, passed rehearsals,
  and rehearsal spend.
- The checklist now includes `Playbook rehearsal` in ordinary operator
  language.
- `foundationReady` now requires a passed zero-spend playbook rehearsal before
  provider setup is considered the only remaining barrier.
- The next safe action becomes `Run Playbook Rehearsal` when the team drill has
  passed but no playbook rehearsal proof exists.

Dashboard changes:
- The AI Team pre-OpenAI panel now shows rehearsal progress beside protected
  proof, comparison decisions, actual spend, and provider gates.
- The panel now exposes a direct `Run Rehearsal` button when rehearsal proof is
  the next safest local foundation step.

Verification: `node --check` passed for `src/runtime/pre-openai-readiness.js`,
`src/runtime/state.js`, `public/app.js`, and `test/runtime.test.js`. Focused
Node tests for pre-OpenAI readiness and playbook rehearsal paths passed 3/3.
`npm.cmd test` passed 56/56 tests. Health check on an isolated runtime at
`http://127.0.0.1:5122/` returned `ok: true`. Browser proof opened the AI Team
tab and confirmed the main runtime showed `2/2 rehearsals passed`, `$0
rehearsal spend`, `$0 actual spend`, and no horizontal overflow. A second
isolated browser-proof runtime created the missing-rehearsal state, confirmed
the pre-OpenAI panel showed `Needs playbook rehearsal` and a visible
`Run Rehearsal` button, clicked it, and confirmed the panel moved to
`Needs comparison request` with `1/1 rehearsal passed`, `$0 actual spend`, a
visible next comparison action, no console warnings/errors, and no horizontal
overflow. No OpenAI credentials, live model flags, live spend, publishing,
customer contact, or external action were used.

### 2026-07-08 - Protected Playbook Rehearsal Suite Added

Added a one-command protected rehearsal suite so the AI Team can practice
worker playbooks together before OpenAI model pathways are connected. The suite
reuses the existing protected team-drill workflow and runner, but marks each
worker task with playbook rehearsal metadata and the current manual market-test
context.

Runtime changes:
- Added `queueAgentPlaybookRehearsalSuite()` in
  `src/runtime/agent-playbooks.js`.
- Added `POST /api/agent-playbooks/rehearsal-suite`.
- Suite tasks remain normal `workbench_proof` tasks, so worker runs, trace
  records, eval checks, cost records, events, and review-state transitions stay
  on the same rails.
- `agentPlaybooks.summary` now reports how many distinct workers have passed a
  protected playbook rehearsal.
- Pre-OpenAI readiness metrics now include rehearsed worker coverage.

Dashboard changes:
- The Protected Worker Playbooks panel now has a `Run Rehearsal Suite` button.
- The Playbooks and Pre-OpenAI readiness panels now show worker rehearsal
  coverage in plain language.

Verification: `node --check` passed for `src/runtime/agent-playbooks.js`,
`src/runtime/pre-openai-readiness.js`, `src/server.js`, `src/runtime/state.js`,
`public/app.js`, and `test/runtime.test.js`. Focused Node tests for playbook
rehearsal, playbook rehearsal suite, and pre-OpenAI readiness passed 5/5.
`npm.cmd test` passed 58/58 tests. Health check on an isolated runtime at
`http://127.0.0.1:5124/` returned `ok: true`. Browser proof opened the AI Team
tab, confirmed the `Run Rehearsal Suite` button was visible, clicked it, and
confirmed the dashboard updated to `11/11 rehearsals passed`, `11/11 workers
rehearsed`, `$0 rehearsal spend`, `$0 actual spend`, and `Needs comparison
request` as the next pre-OpenAI step. Console checks returned no warnings or
errors, and the page had no horizontal overflow. No OpenAI credentials, live
model flags, live spend, publishing, customer contact, or external action were
used.

### 2026-07-08 - Worker Model-Connection Readiness Packs Added

Added durable model-connection readiness packs so every AI worker has a local
connection contract before OpenAI model pathways are connected. This converts
the current worker definitions, Workbench evidence, tool policies, operating
briefs, playbook rehearsal state, eval datasets/cases, and provider-readiness
locks into one stored pack per worker.

Official guidance basis:
- OpenAI Agents SDK guidance says agents plan, call tools, collaborate across
  specialists, and keep enough state for multi-step work; it points builders
  toward clean agent definitions, models/providers, runtime loops, orchestration
  and handoffs, guardrails and human review, results/state, tracing, and evals.
- OpenAI tools guidance keeps tool semantics in the agent definition and
  workflow design, with specialists either owning tools directly or being
  exposed as tools under manager control.
- OpenAI eval guidance frames reliable model work as task specification,
  test inputs, result analysis, and iteration.

Runtime changes:
- Added `agent_model_readiness_packs` to the database schema.
- Added `src/runtime/agent-model-readiness.js`.
- Added `GET /api/agent-model-readiness`.
- Dashboard state now exposes `agentModelReadiness` and
  `aiTeam.modelReadiness`.
- Each pack stores the worker instruction packet, input contract, shared and
  worker-specific output contract, safe/approval/locked tool plan, approval
  rules, eval plan, golden fixtures, failure cases, readiness checks,
  provider/model target, official-guidance source metadata, and next safe
  action.
- Packs are generated/upserted from durable runtime state and do not create any
  model calls, credentials, live flags, spend, publishing, customer contact, or
  external side effects.

Dashboard changes:
- AI Team view now has a `Model Connection Packs` summary panel.
- Worker cards show model-pack status, readiness score, and fixture count.
- Worker inspector shows the full model connection pack: provider path, input
  contract, required output, approval rule, tools, eval fixtures, failure cases,
  readiness checks, and current next action.

Verification: focused tests for model readiness packs and the API route passed
4/4. `npm.cmd test` passed 60/60 tests. Health check on an isolated runtime at
`http://127.0.0.1:5125/` returned `ok: true`. Browser proof opened the AI Team
tab and confirmed the initial `Model Connection Packs` panel showed `0/11 packs
locally ready`, `11 eval fixtures`, `44 failure cases`, and the protected
rehearsal-suite button. After running the suite from the UI, the panel updated
to `11/11 packs locally ready`, `11 eval fixtures`, `44 failure cases`, and
the next action to use the packs as the baseline for one capped,
operator-approved model comparison. The Pre-OpenAI panel still showed `$0
actual spend` and the next comparison step. The Demand Validator inspector
showed a `Model Connection Pack` at `100%` with provider path, input contract,
required output, approval rule, tools, golden fixture, failure cases, and
readiness checks. The API returned 11 packs, 11 local-ready packs, 11 fixtures,
44 failure cases, and Demand Validator `ready_before_model_connection`.
Browser console checks returned no warnings or errors, and the page had no
horizontal overflow. No OpenAI credentials, live model flags, live spend,
publishing, customer contact, or external action were used.

## Open Gates

- First live AI pilot: no provider call may run until Daniel confirms the exact
  A$1 Demand Validator fixture, credentials are configured outside the repo,
  `JARVIS_ENABLE_LIVE_MODELS=1` is enabled for that run, the exact scope is
  approved, and output/trace/eval/cost review is ready.
- Gumroad: account creation, KYC, publishing, and any public channel post remain
  Daniel-confirmed actions. No account has been created and no listing has been
  published by this build.
- Live search, email, POD/Gelato/Etsy, paid media, ChatKit, Xero, mobile redesign,
  autopilot, and a second venture are deliberately deferred until first proof.

## Next Best Work

1. With separate action-time confirmation, run one A$1 maximum Demand Validator
   Agents SDK proof over the selected versioned evidence fixture, with no tools
   or handoffs.
2. Have Daniel review commercial usefulness, unsupported claims, trace/eval,
   scope, and reconciled cost. Revise, repeat, promote only reasoning over
   supplied evidence, or stop.
3. Rank three real digital-product opportunities and present one concise
   selection decision.
4. Build the smallest useful selected product and complete its product files,
   economics, risk review, listing copy, Publish Pack, and launch checklist.
5. After Daniel creates the Gumroad account and approves publication, run the
   bounded organic test and import result CSVs until the 14-day/50-view decision
   point.

## Known Limits

- The current agents are runtime task executors with dry-run model policies, not
  live autonomous OpenAI/third-party agents yet.
- There is no always-on cloud deployment yet; the local PC/server must be
  running for the dashboard and runtime to operate.
- The desktop cockpit is operational and browser-proven; mobile is a stable
  stacked fallback, not a final mobile control design.
- No live model, real search, Gumroad account, product listing, market post,
  customer contact, or revenue proof exists yet.
- Legacy Claude-era files are archived under `archive/historical/` and are
  reference-only unless deliberately migrated into current docs or code.

## 2026-07-08 - Capped Model Comparison Packets Before OpenAI Connection

Intent: take the AI Team foundation as far as possible before connecting OpenAI
model pathways. The missing local layer was a durable packet that turns a ready
worker model-readiness pack into one plain-language operator decision, without
running a model or spending money.

Runtime changes:
- Added `agent_model_comparison_packets` to the database schema.
- Extended `src/runtime/agent-model-readiness.js` with
  `queueAgentModelComparisonPacket`.
- Added `GET /api/agent-model-comparison-packets`.
- Added `POST /api/agent-model-readiness/:id/comparison-packet`.
- A ready worker pack now creates a normal workflow, command, blocked
  `live_ai_worker_execution` task, pending `live_ai_worker_spend` approval,
  zero-amount cost request, event, and durable packet.
- Packet content includes worker, fixture, protected baseline, eval plan,
  expected metric, cost cap, hard stops, provider/model target, and
  approve/request-changes/deny meaning.
- The packet stores `noSpendOccurred: true` and remains blocked until explicit
  operator approval plus provider readiness. No OpenAI credentials, live-model
  flag, live adapter execution, publishing, account action, customer contact,
  or money movement is used.
- Pre-OpenAI readiness now counts either a Workbench team-drill comparison or
  a model-readiness comparison packet as the capped comparison step.
- The operator decision inbox now treats model-pack comparison approvals as
  live-comparison decisions and explains them in ordinary business language.

Dashboard changes:
- Model Connection Packs summary now shows packets prepared and decisions
  waiting.
- Ready packs expose a `Prepare Comparison Packet` action from the AI Team
  summary, worker cards, and worker inspector.
- Worker inspector shows the latest comparison packet, fixture, status, and
  cost cap.

Verification:
- `node --test --test-isolation=none test/runtime.test.js` passed 62/62 tests.
- New tests cover the direct runtime path and HTTP API path, including durable
  packet storage, pending approval, blocked task, pre-OpenAI readiness, decision
  inbox rollup, zero actual model spend, and no non-dry-run model calls.
- Health check on an isolated runtime at `http://127.0.0.1:5131/` returned
  `ok: true`, dry-run mode, missing OpenAI credentials by design, live-model
  switch off, adapters visible, and budget room present.
- Browser proof opened the AI Team tab, confirmed initial Model Connection
  Packs showed `0/11 packs locally ready`, ran the protected rehearsal suite
  from the dashboard, confirmed `11/11 packs locally ready`, prepared a Demand
  Validator comparison packet from the dashboard, and confirmed `1 decision
  waiting`, `1 packet prepared`, Pre-OpenAI `ready_before_model_connection`,
  `$0 actual spend`, one pending model-pack comparison approval, zero
  non-dry-run model calls, and no browser console warnings or errors.
- Proof screenshot saved at
  `output/playwright/model-comparison-packet-proof.png`.

Next best work:
1. Add a local comparison review panel that will later display protected output
   beside the first approved live model output.
2. Add packet revision handling so a `Request Changes` decision can generate a
   tighter fixture, smaller cap, or clearer success metric.

## 2026-07-09 - Agents SDK First Live AI Team Direction

Decision correction: use the OpenAI Agents SDK as the first-class live AI Team
execution path. This explicitly supersedes the 2026-07-07 Responses-first live
worker decision without deleting the historical work.

Why:
- The system destination is specialist AI workers doing business work under
  human approval, not a single direct model-call adapter.
- OpenAI Agents SDK guidance better matches specialist workers, handoffs,
  tracing, guardrails, and resumable approval flows.
- Jarvis still needs to own the business runtime: state, approvals, costs,
  logs, trace persistence, evals, dashboard state, hard stops, and continuous
  improvement rules.
- Responses remains useful for direct model calls, research/search adapters,
  and fallback cases where direct provider control is simpler.

Docs changed:
- Updated the master plan to set `Last updated: 2026-07-09`, define
  `AgentRuntime` as the internal live-worker facade, set Agents SDK as the
  primary live AI Team runner, and describe Responses as a lower-level provider
  path.
- Added Plan 1 for the Agents SDK-first direction.
- Saved Plan 2 for cockpit simplification and scoped AI pilot work after the
  Agents SDK direction is locked.
- Added Decision 0004: Agents SDK First Live AI Team.
- Updated Open Gates and Next Best Work so the minimal capped Demand Validator
  SDK pilot comes before widening live worker execution.

Verification:
- Docs-only change; no runtime API, database, dashboard, or test files changed.
- Searched for stale unsuperseded wording listed in Plan 1. Remaining hits are
  the Plan 1 verification checklist itself, Decision 0004 options considered,
  or historical Responses-first references marked as superseded.

## 2026-07-09 - AgentRuntime Facade And SDK Pilot Path Implemented

Intent: convert the Agents SDK-first decision into a real, narrow runtime path
without connecting live provider execution yet.

Runtime changes:
- Added `@openai/agents` and `zod` as runtime dependencies.
- Added `src/runtime/agent-runtime.js` as the internal facade for live AI Team
  execution.
- The facade uses the OpenAI Agents SDK as the primary live worker runner and
  preserves the existing Responses worker adapter as a lower-level fallback.
- Live AI worker readiness now reports the Agents SDK runner as the provider
  gate, including package availability and disable-flag blockers.
- Live worker spend approvals now require the `openai_agents_sdk_runner`
  runtime capability.
- `src/runtime/agent-runner.js` now routes approved live-worker tasks through
  `AgentRuntime`, records `openai-agents-sdk` run mode, and keeps the same
  Jarvis-owned approval, cost, trace, eval, handoff, and Workbench rails.
- Provider failure on the SDK path records failed model-call state, failed
  worker-run state, no-spend cost evidence, and an error event.
- Dashboard/tool-policy labels now show the main path as the Agents SDK runner,
  with the old worker adapter treated as a fallback label.

Proof:
- Focused live-worker tests passed 5/5, covering readiness, approval gate,
  SDK success path, SDK provider failure no-spend path, and HTTP smoke-test
  preparation.
- `npm.cmd test` passed 62/62 tests.
- Syntax checks passed for changed runtime, dashboard, and test files.
- Health check on an isolated runtime at `http://127.0.0.1:5164/` returned
  `ok: true`, dry-run mode, `openai-agents-sdk` as the live AI worker provider,
  SDK runner ready, Responses fallback ready, missing OpenAI credentials by
  design, live-model switch off, and full budget room.
- Browser proof opened the AI Team tab and confirmed OpenAI is not connected,
  OpenAI API key is blocked, live worker flag is blocked, Agents SDK runner is
  ready, budget room is ready, zero spend is confirmed, and no browser console
  warnings or errors were present. The page had no horizontal overflow at the
  default desktop viewport.
- Proof screenshot saved at
  `output/playwright/agent-runtime-ai-team-proof.png`.
- No real OpenAI request, live spend, publishing, customer contact, account
  action, legal/compliance decision, or money movement was performed.

Remaining gate:
- The first real provider-backed Demand Validator run is still intentionally
  locked behind `OPENAI_API_KEY`, `JARVIS_ENABLE_LIVE_MODELS=1`, explicit
  operator approval, budget room, Workbench baseline comparison, trace/eval
  review, output usefulness review, and billing reconciliation.

## 2026-07-09 - Plan 2 Created For Cockpit Simplification And Pilot Review

Created the executable Plan 2 after the Agents SDK facade was implemented.

Plan 2 now prioritizes operator clarity before the first real provider-backed
AI worker run. It keeps the system purpose-built rather than overgrown:

- simplify the dashboard into Command Center, Decisions, Business Tests,
  AI Team, and System;
- add a derived `operatorCockpit` read model instead of a new source of truth;
- add a small `aiPilotReview` surface for the first Demand Validator live pilot;
- compare protected baseline output with live Agents SDK output in one place;
- show contract, trace, eval, cost, risk, hard-stop, and usefulness evidence
  without making the operator hunt through raw records;
- keep all repeat/promote/live actions approval-gated.

Decision: the AI Pilot Review layer is needed, but only as a lightweight review
surface. It should prevent blind expansion of live AI workers, not become a new
manual pipeline.

Verification: docs-only update. No runtime files changed and no tests were
required.

## 2026-07-09 - Plan 2 Cockpit And AI Pilot Review Implemented

Intent: simplify the operator cockpit before the first real provider-backed AI
worker output arrives, and make the Demand Validator pilot reviewable in one
place.

Runtime changes:
- Added `src/runtime/operator-cockpit.js` as a derived read model for top
  decision, money move, active business test, AI Team status, pilot status,
  learning, spend room, and hard-stop risks.
- Added `src/runtime/ai-pilot-review.js` as a derived Demand Validator pilot
  review model.
- Added `POST /api/ai-pilot-review/:agentId/:decision` so useful/change/repeat/
  promote/stop decisions after a live pilot are recorded against the worker run
  with an event.
- Dashboard state now exposes `operatorCockpit`, `aiPilotReview`, and related
  metrics without adding a new source of truth.

Dashboard changes:
- Reduced primary navigation to five sections: Command Center, Decisions,
  Business Tests, AI Team, and System.
- Existing detail panels are grouped under those sections instead of deleted.
- Command Center now shows a compact AI Pilot Review card.
- AI Team now starts with a Demand Validator Pilot card showing protected
  baseline, rehearsal/model-pack readiness, capped comparison approval state,
  contract/trace/cost placeholders, guardrails, and direct decision controls.
- Human-facing pilot statuses now use ordinary language such as `Needs playbook
  rehearsal`, `Ready to prepare pilot packet`, and `Waiting for your approval`.

Verification:
- `node --check` passed for changed runtime, server, dashboard, and test files.
- `npm.cmd test` passed 62/62 tests.
- A broad `node --test --test-isolation=none` run also proved the current
  runtime tests passed, but it failed on archived Claude-era/Vitest tests under
  `archive/historical/`; those files are reference-only and are intentionally
  excluded by `npm.cmd test`.
- Health check on an isolated runtime at `http://127.0.0.1:5169/` returned
  `ok: true`, dry-run mode, missing OpenAI credentials/live-model flag by
  design, SDK runner ready, and zero live AI spend.
- Browser proof loaded Command Center with exactly five nav sections and no
  horizontal overflow; ran System Check and Run Next Task; ran the protected AI
  Team drill; ran the protected playbook rehearsal; prepared a Demand Validator
  comparison packet; confirmed the pilot card moved to `Waiting for your
  approval` with Approve / Request Changes / Deny visible; confirmed zero model
  spend, zero monthly spend, zero live runs, and no browser console warnings or
  errors.
- Proof screenshots saved at
  `output/playwright/plan2-command-center-proof.png` and
  `output/playwright/plan2-ai-pilot-review-proof.png`.

Remaining gate:
- Do not run the first real Demand Validator Agents SDK pilot until the operator
  explicitly approves setup, real credentials are available, `JARVIS_ENABLE_LIVE_MODELS=1`
  is set, budget room is present, the capped approval is pending/approved, and
  billing reconciliation is accepted.

## 2026-07-14 - Foundation-to-First-Revenue Implementation

Intent: turn the broad prototype into one clean, recoverable, commercially
honest path from foundation to first Gumroad revenue without connecting a live
model or performing an external business action.

Direction recorded:

- Gumroad Direct is the first checkout and fulfilment path.
- Private KYC is allowed; public identity remains faceless and voiceless.
- One venture and one real-world test run at a time.
- Normal operator workload is capped at eight hours weekly; an intensive week
  up to 16 hours needs explicit approval.
- Autonomy is earned after five consecutive reviewed successes per exact
  capability, not per worker globally.
- Initial caps are A$1 for the no-tool AI pilot, A$2 for later read-only search,
  A$25 for one optional paid market test, and A$100 total monthly pre-revenue.

Recovery and cleanup:

- Added encrypted source, database, and artifact backup/restore code using
  AES-256-GCM, scrypt, authenticated metadata, Node SQLite backup, and separate
  daily/weekly retention by backup kind.
- Added backup and restore scripts plus `.env.example` and Node 24 engine
  requirements.
- Moved private operator records into ignored `private/` references and moved
  Claude-era, POD, design, superseded plan, and stale log material under
  `archive/historical/`.
- Removed active nested Git/reproducible dependency/temp noise after the earlier
  backup restore proof.
- Archived the remaining legacy generated deliverables, active company-note
  tree, venture templates, and empty MCP configuration. Removed only the
  verified obsolete SQLite snapshot and Python cache from the archive.
- Production seeding now creates the venture and controls without synthetic
  workflows, tasks, approvals, deliverables, messages, or evidence. Historical
  demo proof data is available only when tests request it explicitly.
- The final fresh backup set remains blocked on Daniel confirming a new
  permanent passphrase because the earlier encrypted files' key is not available
  to the current process. Older files will be preserved.
- Private GitHub creation, push, and checkout proof from that remote remain
  action-time external gates.

Runtime truth and safety:

- Added and applied versioned migrations through version 9 without replacing
  `data/runtime.sqlite`.
- Isolated test databases and artifact roots through `scripts/run-tests.js`.
- Made deliverable rendering deterministic and idempotent at one canonical path.
- Added atomic task claims, attempt records, timeout-as-unknown handling,
  setup-blocked recovery, and monitor finding deduplication.
- Bound approvals to venture, workflow, task, worker, provider, model, fixture,
  tools, parameters, turns, output cap, cost cap, and external effects.
- Made approvals expiring, single-use, and invalid after scope changes.
- Separated reserved, incurred estimate, unknown, reconciled, and released cost.
- Added signed local session, CSRF, Origin, and matching WebSocket validation.
- Archived unsupported historical running tests, stale live approvals, protected
  handoffs, review outputs, and setup notifications in place. Nothing was
  deleted from the audit ledger.
- Archived remaining pre-foundation workflow statuses and planned outputs,
  superseded their stale decisions, and repointed retained legacy deliverable
  paths into `archive/historical/`.

Commercial operating model:

- Enforced one active digital-product venture and venture ownership backstops.
- Added the Venture Case, six venture stages, five honest test states, evidence
  provenance, cash contribution, operator-time-adjusted contribution, and four
  work packages.
- Added 11 visible workers grouped as Command, Evidence, Venture, and
  Control/Learning.
- Added per-capability success streaks, explicit promotion, and failure reset/
  suspension with Important Work escalation.
- Added a weekly executive digest with buyer proof, contribution, decisions,
  learning, exceptions, and the next money move.

Cockpit:

- Rebuilt the daily operator surface around Command Center, Decisions, Business
  Tests, AI Team, and System with focused APIs.
- Added one active-venture selector, Important Work, business position, next
  money move, honest current-test state, team pulse, spend status, and weekly
  brief.
- Combined consequential approvals and worker handoffs into the Decisions
  section. Reviews, Suggestions, and History remain separate.
- Added approval/change/decline controls to the decision drawer and retained PDF
  preview in the dashboard.
- Moved technical detail, archived outputs, connections, spend, queue, and
  activity behind System.
- Kept current outputs visible while placing archived output history behind a
  plain-language show/hide control.
- Filtered Activity to recent consequential business events in ordinary
  language while preserving the complete event ledger in SQLite.
- Changed idle workers to Standby with no current assignment; last reviewed
  outcome remains in their detail drawer.

Agents SDK and Gumroad preparation:

- Kept the OpenAI Agents SDK as the mandatory first-class pilot runner behind
  `AgentRuntime`; no Responses fallback can silently satisfy the SDK acceptance
  run.
- Added versioned Demand Validator fixtures, baseline isolation, structured
  output, five-run uniqueness, deterministic checks, Daniel usefulness review,
  A$1 cap, one turn, 1,200-token maximum, no tools, and no handoffs.
- Added privacy-preserving, idempotent Gumroad CSV import and a launch gate that
  requires fee/tax/export recheck immediately before launch.
- No live model, account creation, KYC, publishing, spend, customer contact, or
  public post was performed.

Verification:

- `npm.cmd test` passed 81/81 tests.
- An isolated source copy without dependencies, database, private material, or
  generated artifacts completed `npm.cmd ci`, passed the same 81 tests,
  started on port 5092, and returned `ok: true` from `GET /api/health`.
- The isolated production database contained one active venture and zero
  workflows, tasks, approvals, outputs, experiments, messages, or costs, with
  all nine migrations applied.
- `GET /api/health` returned healthy database state, A$100 monthly cap, zero
  spend, Agents SDK runner available, and live credentials/flags off by design.
- Browser proof at `http://127.0.0.1:5071/` ran one zero-spend internal work
  request, generated four work packages plus a five-page PDF review pack,
  previewed the PDF, and surfaced one consequential handoff.
- The pack scored 39/100 and required more evidence. Codex selected Request
  Changes, which stopped progression and created a plain-language Activity
  record. The queue returned to empty.
- Command Center, Decisions, Business Tests, AI Team, and System were inspected
  in a real browser. All 11 workers were visible. Console warnings/errors were
  empty.
- Layout checks passed at 1440x900, 1280x720, 1024x768, and 390x844 with zero
  horizontal overflow and no clipped buttons.
- A final clean-instance browser check at 1440x900 showed the truthful empty
  Command Center, all 11 workers in four groups, zero horizontal overflow, no
  clipped controls, and an empty browser console.
- After migration 9, System showed five current outputs by default and one
  `Show 27 past outputs` control. The control revealed the retained history on
  demand; the default view contained no stale smoke-test output, no overflow,
  no clipped controls, and no console errors.

Next clean move:

1. Obtain separate action-time confirmation before the first A$1 Demand
   Validator Agents SDK provider run.

## 2026-07-16 - Encrypted Recovery Proven And Clean Remote Baseline Prepared

Daniel approved both outstanding foundation actions: generate and retain a new
permanent recovery key, and create/push the private GitHub baseline.

Recovery proof:

- Generated a new high-entropy passphrase and stored it only in the Windows
  user environment as `JARVIS_BACKUP_PASSPHRASE`; the value was never written
  to the repository or logs.
- Preserved the three older encrypted backups and created fresh encrypted
  source, database, and artifact backups in
  `C:\Users\radul\OneDrive\Jarvis-Codex-Backups`.
- Restored all three fresh files into an isolated temporary root. AES-256-GCM
  authentication and payload SHA-256 verification passed for every backup.
- Compared the restored source with the live backup manifest: 335 files on each
  side and zero differences.
- Restored SQLite returned `integrity_check = ok`, migration 9, one active
  venture, zero spend, and all five current output registrations. All four
  stored Markdown hashes matched and the five-page PDF was present.
- The restored source completed `npm.cmd ci`, passed 81/81 tests, started on an
  isolated port, returned a healthy API, and served the current PDF with HTTP
  200.
- Real-browser proof of the restored cockpit passed at 1440x900, 1280x720, and
  1024x768 with no horizontal overflow or clipped buttons. Current outputs were
  shown by default, 27 past outputs remained opt-in, the PDF preview rendered,
  and the browser console had no warnings or errors.

Privacy and baseline decision:

- Confirmed `private/`, runtime databases/artifacts, `.env`, outputs, and
  temporary proof roots are ignored.
- Found and redacted three historical copies of the real ABN. The actual record
  remains only in the ignored private operator area and encrypted backups.
- Secret scanning found no live API keys, access tokens, or private keys in the
  baseline candidate.
- The old Git history contains private commit metadata and pre-foundation
  identifiers, so it must not be pushed. The private remote starts from a new
  history-free root commit containing only the audited current tree.

Remote status:

- Created private repository
  `https://github.com/DGR-Business/Jarvis-Codex-AI-Business` through GitHub's
  API using the existing Windows credential. The credential was held only in
  process memory and was not printed or persisted in the repository.
- Created history-free root commit `e3f7a81` with a GitHub no-reply author,
  switched this workspace to `codex/foundation-baseline`, added the clean HTTPS
  remote, and pushed only that root to remote `main`.
- Cloned remote `main` into a verified-absent temporary directory. The clone had
  exactly one commit and no database, artifacts, private directory, `.env`, or
  dependencies before installation.
- The fresh remote checkout installed 104 packages from `package-lock.json`,
  passed 81/81 tests, started on isolated port 5094, and returned `ok: true`,
  dry-run mode, zero spend, Agents SDK runner ready, and live credentials/flags
  off by design.
- Fresh production state contained one active venture and zero commands,
  workflows, runs, tasks, deliverables, model/research calls, approvals,
  experiments, results, learning cycles, execution packs, costs, revenue,
  messages, or notifications.
- A real browser loaded that remote checkout with zero horizontal overflow,
  zero clipped buttons, no console warnings/errors, and ordinary-language empty
  business state.
- The private remote/checkout gate and Phase 1 are complete.

No model call, Gumroad action, publishing, spend, customer contact, legal
decision, or money movement occurred.
