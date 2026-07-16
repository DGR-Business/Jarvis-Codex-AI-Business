# Jarvis-Codex Master Plan

Status: living source of truth
Owner: Operator
Maintainer: Codex
Last updated: 2026-07-16

## Current Execution Directive

The active delivery plan is
`docs/plans/FOUNDATION-TO-FIRST-REVENUE-EXECUTION-PLAN-2026-07-14.md`.
It supersedes older backlog ordering without deleting the architectural history.

Current focus:

- one active digital-product venture;
- one real, capped Demand Validator Agents SDK proof;
- one Gumroad Direct product test;
- three independent paid buyers and positive cash contribution;
- no second venture or broad capability expansion before that loop proves
  itself.

Internal foundation status on 2026-07-16:

- versioned migrations through migration 9, isolated tests/artifacts,
  deterministic outputs, atomic
  claims, exact approval scope, honest cost states, timeout recovery, local
  security, evidence provenance, Gumroad CSV privacy, risk-tiered autonomy, and
  the five-section cockpit are implemented;
- 81 automated tests pass, including a production-seed assertion that fresh
  runtime databases contain no fabricated workflows, approvals, outputs, or
  commercial evidence;
- an isolated clean source copy installed from `package-lock.json`, passed all
  tests, started successfully, returned a healthy API, and created one venture
  with zero workflows, tasks, approvals, experiments, costs, or outputs;
- a real-browser internal-work proof passed, including PDF preview, a request-
  changes decision, timeline update, empty active queue, zero browser console
  errors, and no horizontal overflow at target desktop/mobile widths;
- no model call, Gumroad account, publishing, spend, or customer contact was
  performed;
- historical outputs are hidden by default in System and remain available
  through an explicit past-output control;
- a new permanent backup passphrase is stored in the Windows user environment;
  fresh encrypted source, database, and artifact backups were created while
  preserving the older files;
- all three fresh backups passed authenticated restore, source-manifest,
  SQLite-integrity, current-output, clean-install, 81-test, healthy-start,
  PDF-preview, console, and desktop-layout proof;
- the tracked baseline is sealed as history-free root commit `e3f7a81`, so the
  old commits containing private metadata were not pushed;
- private repository `DGR-Business/Jarvis-Codex-AI-Business` now has that clean
  baseline on `main`;
- a fresh checkout from the private remote installed 104 lockfile packages,
  passed 81/81 tests, started healthy, exposed one venture with zero synthetic
  operating or commercial records, and passed a clean real-browser check;
- the recoverable clean-baseline gate is complete. The next gated action is the
  first A$1 maximum Demand Validator Agents SDK pilot.

## 1. North Star

Jarvis-Codex exists to run AI-assisted online business ventures with real
automation, not theatre. The system should take high-level operator instructions,
turn them into tracked work, use agents/tools where they genuinely help, produce
human-friendly deliverables, request approval at the right gates, control costs,
monitor outcomes, and prove profit before expanding autonomy.

The operator should direct, approve, and review. Codex should build, maintain,
test, monitor, and improve the system.

## 2. Operating Principles

- No fake autonomy: a capability is only real when backed by code, state, logs,
  tests, and recoverable failure paths.
- Prompts are not architecture: prompts may guide agents, but the business
  runtime must own state, permissions, retries, costs, approvals, and evidence.
- Dashboard is the source of truth: email, Slack, ClickUp, or mobile views may
  mirror or control work later, but the runtime database and dashboard stay
  canonical.
- Human-facing outputs must be polished: review items use readable names and,
  for major decisions, should become PDF-backed approval packs.
- Dry-run before live: every external adapter must prove a dry-run path before
  credentials or live actions are used.
- Spend is earned: paid model/tool usage is approved only when it has a clear
  commercial purpose, budget, and expected upside.
- Commercial judgement comes first: workflows must improve demand, offer,
  distribution, conversion, fulfilment, feedback, or unit economics. Process
  that does not support those outcomes is overhead.
- Continuous improvement is mandatory: every meaningful commercial action should
  state a hypothesis, smallest useful action, expected metric, actual result,
  learning, and improvement.
- Operator simplicity is a product requirement: agents should do the processing
  and present money moves, evidence, risk, expected upside, and decision buttons
  without making the operator hunt through tabs or documents.
- Human gates protect high-risk actions: publishing, account changes, supplier
  orders, money movement, legal/compliance issues, and autopilot promotion need
  explicit approval.
- Codex maintains the system: when reality changes, Codex updates code, tests,
  docs, and this plan.

## 3. System Layers

1. Runtime state: SQLite now; portable to Postgres/worker queue later.
2. Dashboard: one-screen operator console for commands, workflows, tasks,
   operator decisions, approvals, deliverables, finance, integrations, and
   events.
3. Commercial brain: runtime-generated money moves, business fundamentals,
   expected upside, evidence gaps, and hypothesis/action/result/improvement
   cycles.
4. Commercial results and learning: durable experiments, buyer/channel results,
   customer signal, learning cycles, and scale/revise/pause/kill decisions.
5. Chat/control surfaces: dashboard command intake remains canonical; later,
   ChatKit can provide an embedded agent chat interface over the same runtime.
6. Command intake: natural-language operator instructions become commands,
   workflows, tasks, and deliverables.
7. AI Team: durable specialist worker definitions, job contracts, tool scopes,
   guardrails, handoff targets, output requirements, quality checks, and
   operator-facing worker status and next-owner handoff state.
8. Agent runner: an internal `AgentRuntime` facade that executes safe internal
   tasks and approved live worker pilots while the Jarvis runtime keeps
   ownership of state, approvals, cost limits, logs, trace persistence, evals,
   dashboard state, business rules, retries, failure handling, deliverable
   updates, and QC handoff. The OpenAI Agents SDK is the intended first-class
   live AI Team runner because specialist workers, handoffs, guardrails,
   tracing, and resumable approvals are core requirements. The Responses API
   remains a lower-level provider path for direct model calls, research/search
   adapters, and fallback cases where the runtime should own the loop directly.
9. Model routing: chooses model class by task importance, cost, and risk.
10. Tools and connectors: OpenAI Agents SDK, OpenAI Responses API, Codex,
   research/search, browser/computer use, ChatKit, Gelato, Etsy partner rails,
   email, Slack, ClickUp, Xero.
11. Approval system and decision inbox: operator approval gates, escalation
   messages, AI worker handoffs, review-pack shortcuts, money moves, decision
   history, and promotion criteria.
12. Deliverables and PDFs: Markdown/runtime working files for agents; polished
   PDFs or approval packs for operator review.
13. Venture scorecards: comparable scoring, verdicts, recommendations, risks,
   and kill/scale next actions across different business types.
14. Finance and accounting: budget controls, cost/revenue ledger, ROI evidence,
   and future Xero reconciliation.
15. Monitoring and recovery: events, health checks, retries, alerts, logs, and
    human escalation.
16. Deployment and persistence: local proof first, then always-on hosting only
    when the system needs it and the cost is justified.

## 4. Commercial Operating Model

The system exists to run a simple commercial loop repeatedly:

1. Find opportunities where buyers already show demand.
2. Validate the buyer, problem, price, channel, and risk before heavy building.
3. Build the smallest sellable test.
4. Put it in front of a real channel.
5. Measure attention, clicks, conversion, sales, refunds, cost, and time.
6. Decide scale, revise, pause, or kill.
7. Allocate more time, model/tool spend, and automation only to winners.

The core business agents/process roles are:

- Opportunity Scout: finds niches, buyer pain, search demand, trend signals,
  marketplace gaps, and competitor weaknesses.
- Demand Validator: checks whether people already search, buy, complain, review,
  or pay for similar outcomes.
- Offer Architect: defines buyer, promise, product format, price, positioning,
  and buying trigger.
- Product Builder: creates the smallest sellable product or asset needed for the
  next test.
- Copy and Conversion Agent: prepares titles, descriptions, landing copy,
  emails, thumbnails, and calls to action.
- Distribution Agent: prepares traffic/channel tests across marketplace, search,
  owned audience, social, or partner paths.
- Finance and Unit Economics Agent: tracks price, margin, cost, time, expected
  upside, break-even, and capital allocation.
- Customer Voice Agent: turns reviews, objections, support, refunds, and
  comments into product and offer improvements.
- Growth Analyst: compares expected metrics to actual results and recommends
  scale, revise, pause, or kill.
- Chief of Staff: compresses all agent work into money moves, evidence, risk,
  expected upside, and operator decisions.

Every commercial workflow should expose a runtime-compatible continuous
improvement cycle:

- Hypothesis: what business result is expected and why.
- Smallest useful action: the lowest-risk action that can test it.
- Expected metric: what should change if the hypothesis is true.
- Actual result: what happened in revenue, conversion, evidence, time, or cost.
- Learning: what the result means.
- Improvement: what to scale, revise, pause, or kill next.

## 5. Capability Roadmap

### Stage 1 - Internal Proof

Goal: prove the runtime can plan, run safe internal work, record evidence, and
prepare review outputs without spending money or touching external accounts.

Current status: complete as of 2026-07-16. The protected worker runtime, 11-worker registry,
tool and approval policies, traces, eval fixtures, bounded handoffs, monitoring,
cost controls, deterministic review outputs, one-venture scorecard, and PDF
review path are implemented and tested. Demo proof records are test-only; a
new production database starts with no synthetic work or evidence.
Runtime startup now explicitly backfills the AI Team foundation for existing
initialized databases: registered workers, tool permissions, integration
records, eval datasets/cases, scheduler jobs, and scorecards are ensured before
the operator opens the dashboard.
The desktop cockpit now has a derived `operatorCockpit` read model and a scoped
`aiPilotReview` read model. The dashboard navigation is simplified to Command
Center, Decisions, Business Tests, AI Team, and System while preserving the
underlying approval, Workbench, model-pack, trace, eval, cost, event, and
deliverable evidence. Demand Validator pilot preparation can now move from
protected baseline to playbook rehearsal to capped comparison packet and
operator approval without requiring the operator to hunt through raw records.
The AI Team is now connected to the digital-product commercial loop: planning
work includes offer, product, copy, distribution, customer-signal, and
result-analysis specialists; execution packs create Product Builder, Copy and
Conversion, Finance and Unit Economics, and Distribution worker runs; recorded
commercial results create a Growth Analyst run; and buyer feedback creates a
Customer Voice run.
Execution-pack outcomes now also create a Chief-of-Staff outcome decision
packet, so a result, no-response signal, reply, or objection is compressed into
one operator-facing next decision with the money move, evidence, risk, actual
result, learning, improvement, hard stops, and linked handoff controls.
Every worker run now has a shared `jarvis_worker_business_decision_v1`
contract: buyer, problem, offer, channel, money move, evidence summary, risk,
success metric, stop/change rule, approval requirement, locked external-action
state, and continuous-improvement fields. The evaluator checks this contract
alongside normal summary/evidence/next-action requirements, and the dashboard
inspector surfaces the money move and decision fields directly from task and
worker-run records.
The Agent Workbench now turns those raw records into an operator-readable
promotion gate. Each registered worker gets a durable readiness dataset and
baseline contract/safety test case. The Workbench compares protected dry-run
proof with live-worker evidence, scores readiness, shows missing items such as
provider setup or trace review, and produces a plain-language promotion
decision: needs protected proof, ready for one capped live test, waiting for
approval, failed and needs review, or ready only for narrow capped live use.
It keeps the Request Live Test path approval-gated instead of letting a named
worker silently jump to live model spend.
The Workbench can now also run a selected worker's protected proof directly
from the AI Team dashboard. The proof creates a normal workflow, command, task,
worker run, trace, eval, cost record, and promotion-gate update, but it stays
inside protected mode with no live model call, customer contact, publishing,
account action, or spend.
The Workbench can also run the core digital-product AI Team as one protected
drill. The dashboard command queues the Chief of Staff, Opportunity Scout,
Demand Validator, Offer Architect, Product Builder, Copy and Conversion,
Distribution, Finance and Unit Economics, Customer Voice, Growth Analyst, and
Quality Reviewer as normal protected proof tasks under one workflow. This proves
the crew together while preserving the same dry-run, trace, eval, cost, and
promotion gates used by individual workers.
When the protected team drill finishes, the Chief of Staff now compresses the
worker proof into one operator-facing summary: workers passed, spend, blockers,
locked actions, money move, next decision, and continuous-improvement learning.
The dashboard surfaces that summary in the workflow inspector with direct
controls for a review pack, a capped live-worker test request, or rerunning the
protected drill.
That capped live-worker request is now a Workbench comparison request rather
than a generic live-worker button. It selects the relevant specialist from the
protected drill, carries protected proof evidence into the spend approval,
stores the pending comparison on the workflow summary, and leaves execution
blocked until explicit approval plus provider readiness pass.
The AI Team dashboard now also has a pre-OpenAI readiness surface. It reports
how far the local foundation can go before any OpenAI model connection:
registered workers, contracts/evals, protected proof, full-team drill coverage,
capped comparison request, protected playbook rehearsal coverage, operator
decision gate, zero actual spend, locked actions, and the remaining provider
gates. It does not report the local foundation as ready until at least one
worker playbook has passed a protected rehearsal with zero spend. This keeps
the operator focused on what is proven and what is intentionally still locked,
rather than forcing a manual hunt through workflows, approvals, costs, and
worker traces.
The AI Team now also exposes operator-facing worker operating briefs. Each
brief turns the durable worker definition, tool permissions, Workbench status,
approval rules, evidence standard, handoff targets, and continuous-improvement
rule into plain business language. This makes the AI Team inspectable before
model connection: the operator can see what each worker owns, what it must
produce, which tools are safe, which actions need approval, which actions are
locked, what proof currently exists, and the next safe step.
The AI Team also exposes protected worker playbooks. Each playbook defines when
to use the worker, the first protected move, local steps, evidence to capture,
handoff target, success metric, stop rule, and model-connection rule. These
playbooks make the team executable in protected local mode before live OpenAI
worker calls are trusted.
Protected playbooks can now be rehearsed as normal local worker proof runs.
The rehearsal path uses the same durable workflow, command, task, worker-run,
trace, eval, cost, event, and dashboard-state rails as the Agent Workbench, but
adds playbook metadata and the current manual market-test context. A selected
worker can rehearse alone, or the operator can run a full protected playbook
rehearsal suite for the team from one dashboard command. This lets workers
practice their protected playbooks against the business test queue before any
live model call, external action, or spend is considered.
Each worker now also gets a durable model-connection readiness pack before any
OpenAI model pathway is connected. The pack stores the worker's instruction
packet, input contract, required output contract, tool plan, approval rules,
eval fixtures, failure cases, readiness checks, provider/model target, and
next safe action. The packs follow current OpenAI agent guidance by keeping
specialists narrow, mapping tools and ownership explicitly, preserving
human-review guardrails for risky work, and treating eval fixtures and failure
cases as the baseline for any later capped model comparison.
Ready packs can now be turned into durable capped model-comparison packets
without connecting OpenAI. A packet creates a normal workflow, command,
blocked live-worker task, spend approval, cost-request record, event, and
operator-decision item, but records no-spend proof and remains locked until
the operator approves and provider readiness passes. The packet states the
worker, fixture, protected baseline, cost cap, expected metric, hard-stop
rules, and approve/request-changes/deny meaning in operator-facing language.
The dashboard and runtime now also expose a unified operator decision inbox.
It normalizes pending approvals, AI worker handoffs, live-comparison requests,
commercial money moves, and ready PDF review packs into one operator-facing
queue. Each item states the money move, evidence, risk, cost cap, expected
upside, whether spend has occurred, and the available Approve / Request Changes
/ Deny or review actions. This is the control plane the system should use
before live OpenAI paths are connected: agents do the processing, then the
operator sees one business decision rather than hunting through separate tabs.
The dashboard and runtime now also expose a Manual Market Test Cockpit. It
turns ranked test options, promoted tests, execution packs, worker handoffs,
market outcomes, and learning cycles into one run-focused surface. The operator
can see the buyer, offer, channel, cost cap, expected upside, hard stops, run
sheet, approval/change/deny controls, result capture, reply capture, and
no-response capture in one place. This is the practical local bridge between
AI Team preparation and real market evidence before OpenAI model pathways or
external channel automation are connected.
Learning cycles can now create revised test options without a model call. A
Chief-of-Staff outcome packet or commercial learning row can be converted into
three ranked test candidates that carry source links to the learning cycle and
execution pack. This closes the local loop from hypothesis, result, learning,
and improvement back into the next controlled test before live OpenAI pathways
are connected.
Worker tools now have a durable policy registry. Each named worker tool is
classified as protected internal, approval-controlled, or locked, with risk,
approval scope, provider capability, live flag, spend possibility, and external
action metadata. Worker assignments are derived from the AI Team definitions,
and the Agent Workbench checks that no hard-stop tool is assigned before a
worker can move toward live testing.
Worker tool use now runs through a durable invocation gate. Each attempted tool
use is recorded as allowed, approval-required, or blocked. Protected use of
approval-controlled tools is allowed only when the tool has a no-side-effect
path; live use requires an approved operator decision; hard-stop, unassigned,
and unknown tools are blocked and traceable.
Approval-required worker tool use now pauses the worker run instead of being
treated as a failure. The approval payload records the worker, tool, invocation,
run, task, workflow, and resume instructions. Approving the tool marks the
invocation as approved for live use and queues the paused worker task to resume;
requesting changes or denying marks the invocation as stopped and leaves a
traceable operator decision without any live tool call or spend.
Worker runs that need a next owner now create durable handoff records with the
source worker, next worker, workflow/task links, risk level, plain-language
decision needed, dashboard visibility, and Approve / Request Changes / Deny
controls that write back to runtime state, traces, events, and linked workflow
status. Approved handoffs queue a protected Chief-of-Staff follow-up task, so a
decision becomes executable internal work rather than a closed card.
Completed Chief-of-Staff follow-ups now produce a structured next business
action with recommendation, evidence, risk, cost cap, hypothesis, expected
metric, kill criteria, hard stops, and dashboard action shortcuts. The
commercial brain surfaces those follow-ups as Money Moves so the operator can
open the follow-up, open the workflow, plan the next test, or generate a review
pack without hunting through raw task records.
Commercial results, feedback, and learning cycles can now be recorded manually
or through API routes, and those outcomes update scorecards and Money Moves.
When the outcome comes from an execution pack, the Commercial Brain now prefers
the Chief-of-Staff outcome packet for the learning Money Move instead of
forcing the operator to interpret raw metrics and learning rows.
Research or operator idea briefs can now be converted into ranked commercial
test options, promoted into active commercial experiments without live spend,
and turned into execution packs with copy, channel steps, unit-economics review,
tracking plans, checklists, and local result/feedback shortcuts.
Completed live research now automatically converts into a source-linked
commercial brief and ranked next-test candidates, with a worker trace event,
dashboard Money Move visibility, and idempotency so reruns do not duplicate
operator work.

Done when:
- Command intake creates workflows, tasks, approvals where needed, and
  human-facing deliverables.
- Commercial brain turns runtime state into money moves with evidence, expected
  upside, risk, decision controls, and improvement-loop metadata.
- Commercial results record views, clicks, leads, sales, refunds, revenue,
  spend, time, feedback, and learning decisions.
- Research-to-experiment planning turns a buyer/problem/offer/channel/price
  brief into ranked test options with success metrics, unit economics, and kill
  rules.
- Promoted tests can generate practical execution packs that show the offer
  copy, manual channel plan, tracking plan, result checklist, and one-click
  outcome capture without sending, publishing, or spending.
- Learning cycles compare hypothesis, expected metric, actual result, learning,
  and improvement, then feed Money Moves and scorecards.
- Execution-pack results, no-response signals, replies, and objections are
  compressed into a Chief-of-Staff next-decision packet with approval controls
  and operator-readable evidence.
- Command intake can optionally auto-run safe dry-run work until the next gate.
- Dry-run agent runner executes planned internal tasks one safe step at a time.
- AI Team registry defines narrow specialist workers with instructions, allowed
  tools, guardrails, handoff targets, input/output contracts, approval policy,
  and evaluation criteria.
- Worker operating briefs expose those contracts in ordinary operator language:
  ownership, inputs, required outputs, evidence standards, allowed tools,
  approval-controlled tools, hard stops, proof status, next safe action, and
  improvement rule.
- Worker playbooks expose the protected execution pattern for each specialist:
  trigger, first move, steps, evidence captured, handoff, success metric, stop
  rule, and model-connection rule.
- Worker playbook rehearsals can queue and run protected local proof against
  the current manual market-test context, recording task/run/eval/cost evidence
  and zero external action.
- Runtime startup backfills AI Team workers, controlled tools, integration
  records, and eval readiness cases for existing initialized databases without
  wiping operator work.
- Every AI worker output carries a structured business-decision contract with
  buyer, problem, offer, channel, money move, evidence, risk, success metric,
  stop/change rule, approval state, hard stops, and improvement-loop fields.
- Agent tasks create durable worker runs, trace events, quality/eval checks, and
  dashboard-visible worker status before they are treated as reliable labour.
- Eval checks fail or flag workers that omit required business-decision or
  output-contract fields, preventing vague agent output from being treated as
  operator-ready work.
- Agent Workbench records durable eval datasets/cases for every worker, then
  computes worker readiness from definition completeness, dry-run evidence,
  trace/eval proof, approval policy, provider readiness, pending approvals, and
  dry-run-versus-live comparison records.
- Agent Workbench can run a selected worker's protected proof as a first-class
  dashboard/API command, producing a normal queued task, worker run, trace
  events, eval result, and promotion-gate update without live spend.
- Agent Workbench can run the core digital-product AI Team as one protected
  dashboard/API drill, producing normal queued worker tasks, runs, traces,
  evals, zero-spend cost evidence, and promotion-gate updates without live
  model calls, external contact, publishing, account actions, or spend.
- Completed protected team drills create a Chief-of-Staff team summary with
  worker pass counts, cost evidence, blockers, hard stops, next decision,
  continuous-improvement learning, durable event/message records, and dashboard
  controls so the operator does not need to inspect every worker proof manually.
- Workbench live-comparison requests turn a completed protected team drill into
  one capped specialist live-worker approval request with protected proof
  evidence, expected metric, cost cap, selected worker, workflow metadata,
  event records, and no live spend before approval plus provider readiness.
- Pre-OpenAI readiness reporting rolls up worker registration, contracts/evals,
  protected proof, team-drill evidence, protected playbook rehearsal proof,
  capped comparison approvals, zero actual spend, locked actions, and provider
  gates into one operator-facing AI Team dashboard surface before model
  credentials or live flags are connected.
- Model-connection readiness packs persist one pack per worker with
  instructions, input/output contracts, tool plan, approval rules, eval
  fixtures, failure cases, readiness checks, and provider/model target before
  any live OpenAI model pathway is connected.
- Model-comparison packets persist one capped operator decision per selected
  ready worker pack, including fixture, protected baseline, expected metric,
  cost cap, approval/task/workflow links, and no-spend proof before any OpenAI
  model pathway is connected.
- Operator decision inbox rolls up pending approvals, worker handoffs,
  live-comparison requests, money moves, and ready review packs into one
  dashboard/API surface with plain business language, evidence, risk, cost cap,
  no-spend state, expected upside, and direct approve/change/deny or review
  controls.
- Manual Market Test Cockpit rolls up test options, promoted tests, execution
  packs, worker handoffs, outcome history, and learning cycles into one
  dashboard/API surface with plain business language, run-sheet copy, hard
  stops, no-spend state, approval controls, result capture, reply capture, and
  no-response capture before live OpenAI pathways are connected.
- Learning cycles can generate revised test options with source-linked brief
  metadata, ranked candidates, idempotency, dashboard controls, and API access,
  so the system turns actual results into the next controlled market test
  without requiring an OpenAI model call.
- Agent Workbench promotion gates turn dry-run proof, live output, trace
  coverage, eval score, cost, hard-stop controls, and provider readiness into
  a user-facing recommendation before any worker can be trusted for wider live
  use.
- Dashboard AI Team view shows each worker's readiness status, score, missing
  evidence, promotion recommendation, next safe action, protected-run proof,
  live comparison, and live-test request control in ordinary operator language.
- Worker tool permissions are registered durably and visible in the dashboard:
  safe internal tools, approval-controlled live tools, and locked tools are
  separated before any live model, publishing, spend, customer, account, legal,
  or finance action can be attempted.
- Worker tool invocations are recorded durably and enforced before execution:
  allowed protected calls proceed, live calls create or require operator
  approval, and hard-stop/unknown/unassigned tools are blocked with traces,
  events, and dashboard/API visibility.
- Approval-required worker tool calls pause and resume from durable runtime
  state: approve queues the paused task to continue, while request changes or
  deny stops the worker step with plain-language events and traces.
- Agent tasks and commercial-loop workers create durable handoffs whenever a
  next owner or operator decision is needed, so the dashboard can show the
  worker route, decision, risk, and related workflow without hunting through
  raw records.
- Worker handoffs can be decided from the dashboard or API. Approving closes
  the handoff for the next safe step and queues Chief-of-Staff follow-up;
  requesting changes or denying records the operator note, stops the linked
  workflow as needs changes, and creates a visible message for follow-up.
- Approved handoffs create a protected `handoff_followup` task that runs through
  the same task ledger, model policy, trace, eval, cost, deliverable, and
  dashboard surfaces as other AI worker tasks.
- Completed `handoff_followup` tasks create a durable Chief-of-Staff next
  business action that is recorded in the task result, trace events, activity
  events, messages, and Overview Money Moves.
- Commercial execution packs, results, and buyer feedback create protected
  specialist worker runs so product scope, copy, finance/unit economics,
  distribution, Growth analysis, and Customer Voice analysis are visible in the
  AI Team ledger.
- Live AI worker execution now has an approval-gated OpenAI Responses adapter:
  integration health, readiness checklist, capped smoke-test preparation,
  workflow-level request action, spend approval, provider preflight, structured
  result handling, model-call records, trace/eval records, cost records,
  provider-failure no-spend evidence, and dashboard/API visibility.
- Safe run loops execute queued dry-run work until review, approval, failure, idle, or step-limit boundaries.
- Safe run loops create durable workflow-run records for monitoring and audit.
- Task results include model policy, tool policy, cost budget, actual cost,
  output, and review requirement.
- Deliverables update from planned to drafting to ready for review.
- PDF approval packs are generated from workflow deliverables, task evidence, and commercial scorecards.
- Venture scorecards give different business types a comparable score, verdict,
  risks, recommendation, and next actions.
- Retryable failures return to the queue; exhausted failures stop downstream
  work and create urgent escalation messages.
- Runtime monitor cycles record health runs and findings for approvals, escalations, stale work, budget, and integrations.
- Persistent scheduler jobs can run monitor cycles and keep safe-work autopilot disabled until explicitly enabled.
- Tests cover planning, running, retries, failures, approvals, blocked work, API
  state, and dashboard behavior.

### Stage 2 - Controlled AI Worker And Research Proof

Goal: connect real research/model calls for market, competitor, pricing, and
risk evidence while keeping spend and external actions controlled.

Current status: adapter contract, durable research run/source tables, dry-run
source capture, stale-data warnings, zero-spend research task integration,
budgeted live-research request tasks, provider-readiness preflight checks, a
live-research readiness surface, a capped smoke-test preparation path, and an
OpenAI Responses API web-search research adapter are implemented and stub-tested.
The research-to-experiment bridge now converts researched or operator-supplied
commercial briefs into ranked offer/channel/price test candidates using Money
Move Contract, AARRR, ICE-style prioritisation, Unit Economics Gate, and
Build-Measure-Learn fields.
Promoted test candidates can now create local execution packs so market-contact
work is reduced to copy, checklist, tracking, and result-capture controls.
The first local capped smoke-test approval has been prepared for a digital
product idea without provider calls or spend. The adapter records query/provider
metadata, live sources, model-call estimates, cost estimates,
completion/failure events, and scorecard upgrades. Real live model/email
providers are not connected yet, and the first real live research execution
still requires credentials plus operator approval.
Parallel to live research, the system now has a live AI worker readiness/request
rail using the same safety pattern: capped request tasks, spend approval,
provider-readiness checks, dashboard health, zero-spend smoke-test preparation,
and an OpenAI Responses execution adapter preserved as useful lower-level
provider infrastructure. The first-class live worker path is now an internal
`AgentRuntime` facade backed by the OpenAI Agents SDK, with Demand Validator as
the first capped pilot worker behind the same approval, cost, trace, eval, and
dashboard rails. The SDK path is implemented and locally stub-tested for
success, provider failure, no-spend evidence, worker traces, evals, model-call
records, cost records, and Workbench promotion-gate updates. A live AI worker
request can target a registered specialist such as Demand Validator, preserve
that specialist identity through task, approval, spend-gate, provider-blocked,
live-run, trace, eval, cost, and dashboard records, and reject unknown explicit
workers instead of silently falling back. Real provider execution still requires
credentials, the live-model flag, approval, trace/eval review, and billing
reconciliation.
Completed live research is now piped directly into the research-to-experiment
bridge. A successful live research run produces one source-linked brief, three
ranked approval-safe commercial test candidates, a trace event, and Money Move
visibility without publishing, sending, account actions, or extra spend.

Done when:
- Research adapter has query logs, citations/sources, stale-data warnings, and
  source-count review behavior.
- Model calls are budgeted per task and logged in the cost ledger.
- Live research success and provider failure paths are covered by local stub
  tests before real API spend is allowed.
- Dashboard and API expose readiness blockers before a live smoke run is approved.
- Research deliverables include evidence, confidence, assumptions, and kill/keep
  recommendation.
- Live or dry-run research can create ranked next-test candidates that include
  buyer, problem, offer, channel, price, cap, success metric, and kill criteria.
- Promoted test candidates can create execution packs that stay manual,
  dry-run, and approval-safe while feeding results and customer signal back into
  the learning loop.
- Execution packs create specialist worker proof plus a Chief-of-Staff decision
  packet that gives the operator the money move, evidence, economics, risk,
  handoff decision, and result shortcuts without hunting through separate tabs.
- The operator can approve or reject research spend from the dashboard.
- Spend approval gates block paid AI/tool work before execution.
- Approved live research still blocks until provider credentials, live flags, and
  runtime adapter readiness all pass.
- Live AI worker requests can be prepared and approved without spend, and still
  block unless OpenAI credentials, live-model flag, adapter readiness, budget,
  and per-run approval all pass.
- Live AI worker requests preserve a specific requested specialist from
  dashboard action through task, approval, spend decision, provider readiness,
  worker run, trace/eval, cost, result, and operator view.
- The first approved live AI worker pilot runs Demand Validator through the
  `AgentRuntime` facade with the OpenAI Agents SDK as the primary runner,
  recording a live model call, worker run, SDK trace/reference metadata, eval,
  output, and estimated cost; provider failures record failed worker/model
  state and no-spend evidence.
- The first Demand Validator pilot has a scoped AI Pilot Review surface that
  shows protected baseline, playbook/model-pack readiness, capped comparison
  approval state, trace/eval/cost placeholders, hard stops, and the
  approve/change/deny controls before any real live model call can run.
- Approval-gated worker tools now preserve paused run state, approval decisions,
  and resume/stop outcomes in task state, tool-invocation records, trace events,
  and dashboard approval details.

### Stage 3 - Paid Tool and Model Execution

Goal: allow approved paid generation and tool work for commercially promising
ideas.

Done when:
- Model router selects cheap/fast models for simple tasks and stronger models
  for high-risk decisions.
- `AgentRuntime` is implemented as the internal business-runtime facade for
  live AI Team execution, with the OpenAI Agents SDK as the primary runner and
  Responses API kept as a lower-level provider path for direct calls,
  research/search adapters, and fallback cases.
- The first minimal Agents SDK pilot is Demand Validator, capped,
  approval-gated, no publishing, no customer contact, no account actions, no
  legal/compliance decisions, and no money movement.
- Live AI worker execution follows the official OpenAI agent architecture
  principles: narrow worker instructions, tool scopes, guardrails, traces,
  resumable approvals, result records, and eval checks.
- Live AI worker tasks cannot be marked complete by a dry-run fallback.
- Paid image/design/PDF generation has per-task caps and approval rules.
- Retry logic and failure escalation are proven.
- No paid action can run without budget policy and event logging.

### Stage 4 - First Commercial Venture

Goal: launch the first controlled digital-product venture path with real
deliverables, approval, publishing plan, and performance feedback. POD/Gelato
remains a later guarded path after the lower-fulfilment digital-product pilot.

Done when:
- A venture has research, commercial snapshot, risk screen, mockups/assets,
  approval pack, execution pack, and publish plan.
- Publishing adapter has a dry-run and live approval path.
- Revenue, costs, and performance metrics are tracked weekly.
- The operator sees a clear continue, revise, or kill recommendation.

### Stage 5 - Partial Autopilot

Goal: allow narrow autopilot only inside proven workflows.

Done when:
- At least 20 relevant approvals are decided.
- First-pass approval rate is at least 90 percent for the workflow/family.
- No unresolved high-risk failures are open.
- Spend thresholds, veto windows, and rollback paths are implemented.

### Stage 6 - Broader Fleet

Goal: run multiple ventures and channels with shared monitoring, finance, and
quality controls.

Done when:
- Ventures have comparable scorecards and kill/scale rules.
- Finance/accounting reconciliation is reliable.
- Agent/task load, spend, and alerts are manageable from dashboard and mobile.
- Codex can upgrade and repair the system without operator coding work.

## 6. Decision Gates

Operator approval is required for:

- Any live publishing or externally visible marketplace/account action.
- Any paid spend outside an already approved budget rule.
- New credentials, OAuth connections, or account creation.
- Supplier orders, fulfilment settings, refunds, disputes, or customer messages.
- Legal, tax, compliance, trademark, copyright, or platform-risk decisions.
- Promotion from one autonomy stage to the next.
- Any action that could damage an account, reputation, or finances.

## 7. Risk Register

| Risk | Why it matters | Control |
|---|---|---|
| Fake autonomy | Demos look impressive but cannot run a business | Require state, logs, tests, and failure paths |
| Runaway spend | API/tool costs exceed business value | Budget caps, approval gates, cost ledger |
| Hallucinated research | Bad evidence leads to bad products | Sources, confidence, stale-data checks, QC |
| Poor product-market fit | System builds things nobody buys | Research gates, kill rules, performance review |
| IP/trademark/platform risk | Listings or accounts can be removed/banned | Risk screen, hard-stop escalation |
| Account action mistakes | Automation can harm live accounts quickly | Dry-run adapters, live approval gates |
| Low-quality outputs | Operator wastes time reviewing weak work | QC tasks, approval history, feedback memory |
| Over-complex stack | Too many services make the system fragile | Prefer simple local runtime until scale demands more |
| Vendor lock-in | One AI/tool provider may become costly or weak | Model/tool abstraction and cost-performance logs |
| Security/secrets leakage | Credentials or private data could leak | Environment variables, no secrets in repo |

## 8. Current Backlog

### Now

1. With separate action-time approval, run exactly one A$1 maximum Demand
   Validator Agents SDK pilot over one versioned evidence fixture, with no
   tools or handoffs.
2. Compare the SDK result with the protected baseline, have Daniel judge
   commercial usefulness, reconcile cost, and decide revise, repeat, promote
   only the exact capability, or stop.
3. Preserve the proven recovery behavior: encrypted source/database/artifact
   backups, authenticated restore, retention, and private operator records.
4. Preserve the proven clean-source behavior: lockfile install, 81/81
   tests, healthy startup, and no synthetic production work or evidence.

### Next

1. Rank three digital-product opportunities and present one concise selection
   decision.
2. Build the smallest useful selected product and complete its Publish Pack.
3. After Daniel creates the Gumroad account and approves publishing, run the
   14-day or 50-qualified-view test and import results from Gumroad CSV.

### Later

1. Add a separately capped A$2 read-only web-search capability only after the
   no-tool reasoning capability completes its five-run review sequence.
2. Offer one optional A$25 paid test only if organic reach is insufficient.
3. Add paid media tools only after three sales or evidence that media quality
   is the conversion blocker.
4. Defer live email, POD/Gelato/Etsy, ChatKit, Xero, narrow autopilot, mobile
   redesign, and additional ventures until first revenue proof justifies them.

## 9. Update Protocol

Every meaningful build session should:

1. Read this master plan and the build log first.
2. Pick the highest-value next item for the current stage.
3. Implement a small, testable slice.
4. Run verification.
5. Update this plan if scope, stage status, backlog order, or risks changed.
6. Update the build log with decisions, proof results, and next actions.
7. Report what changed, what was verified, and what remains unbuilt.

Supporting docs:

- Build log: `docs/Jarvis-Codex Build Log.md`
- Architecture notes: `docs/architecture/`
- Decision records: `docs/decisions/`
- Detailed build plans: `docs/plans/`
- Agents SDK first live AI Team decision:
  `docs/decisions/0004-agents-sdk-first-live-ai-team.md`
- One venture to first revenue decision:
  `docs/decisions/0005-one-venture-to-first-revenue.md`
- Plan 1:
  `docs/plans/PLAN-1-AGENTS-SDK-FIRST-LIVE-AI-TEAM-2026-07-09.md`
- Plan 2:
  `docs/plans/PLAN-2-STREAMLINE-COCKPIT-AND-SCOPED-AI-PILOT-2026-07-09.md`
- Foundation-to-first-revenue execution plan:
  `docs/plans/FOUNDATION-TO-FIRST-REVENUE-EXECUTION-PLAN-2026-07-14.md`
- Current Codex runtime architecture:
  `docs/plans/CODEX-RUNTIME-ARCHITECTURE-2026-07-04.md`
