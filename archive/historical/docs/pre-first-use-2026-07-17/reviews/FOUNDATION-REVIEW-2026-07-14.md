# Jarvis-Codex Foundation Review

Date: 2026-07-14
Status: Review complete; implementation response applied 2026-07-14
Reviewer: Codex, supported by five independent specialist reviews
Scope: active source, database, dashboard, tests, plans, generated artifacts,
historical material, commercial operating model, and OpenAI Agents SDK path

## Implementation Response

The review remains the historical critical assessment. Its main internal
findings have now been addressed by the Foundation-to-First-Revenue execution
work:

- encrypted backup/restore and retention code is implemented and test-proven;
- tests and artifacts are isolated from operator deliverables;
- output rendering is deterministic and idempotent;
- migrations, task claims, exact approval scope, honest cost states, timeout
  recovery, local HTTP/WebSocket security, monitor deduplication, and evidence
  provenance are implemented;
- false running tests, stale provider approvals, protected handoffs, review
  outputs, and setup notices were archived in place without deleting history;
- the cockpit is reduced to five clear sections with focused APIs and ordinary
  business language;
- the first SDK pilot is honestly defined as reasoning over supplied evidence,
  not live demand research;
- Gumroad Direct, private KYC, faceless/voiceless public identity, five-run
  capability promotion, and one-venture/one-test limits are recorded;
- the full suite passes 80/80 and the real-browser proof passes.

Two recovery/external gates remain open: a new permanent backup passphrase plus
fresh restore proof, and action-time approval to create/push the private GitHub
baseline. No live model or external commercial action has been performed.

## Executive Verdict

Jarvis-Codex is a real and promising local control-plane prototype. Persistent
state, dry-run work, approvals, cost estimates, events, retries, monitoring,
commercial result records, and one narrow OpenAI Agents SDK facade exist in
working software. The current 62-test suite passes in an isolated copy.

It is not yet an autonomous AI business team, a multi-venture operating system,
or a proven money-making system. It has built substantially more control,
readiness, scoring, document, and dashboard machinery than it has real market
execution. The system currently proves Jarvis more often than it proves a
business.

The right move is not a rebuild. Keep the sound control-plane core, remove false
signals and duplicate process, make one venture/test/decision the canonical
operating unit, then run one honest provider-backed worker pilot followed by one
real commercial loop.

## Purpose Fit

The intended purpose is clear:

- specialist AI workers do most of the research, preparation, analysis, and
  coordination;
- Daniel receives compressed, consequential decisions;
- external risk, spend, publishing, accounts, legal matters, and money remain
  human-controlled;
- each venture learns from actual outcomes and improves;
- multiple ventures can eventually run in parallel.

The current reality is:

| Capability | Current reality |
| --- | --- |
| Persistent control plane | Genuine prototype |
| Dry-run safety | Strong and well tested |
| Live AI worker | One structured, stub-tested SDK call path |
| AI team collaboration | Mostly modeled in local records and templates |
| Demand validation | Simulated or manually entered; no live evidence yet |
| Selling and fulfilment | Absent or assigned to Daniel manually |
| Learning loop | Implemented, but evidence provenance is weak |
| Multi-venture operation | Schema-shaped only; no real venture control |
| Operator cockpit | Visually coherent but too dense and internally focused |
| Revenue proof | None |

## What Is Working

1. SQLite persistence and the main runtime lifecycle are real. Workflows, tasks,
   approvals, events, costs, results, agent records, and scheduler state survive
   process restarts.
2. Dry-run is the default. Publishing, customer contact, account actions, legal
   decisions, and money movement remain locked.
3. Approval, retry, failure, event, PDF preview, commercial-result, and learning
   paths have broad integration coverage.
4. The `AgentRuntime` facade is the correct ownership boundary. Jarvis retains
   state, approvals, costs, business rules, and dashboard truth while the SDK can
   manage a worker loop.
5. Commercial concepts are present: buyer, problem, offer, channel, price,
   evidence, metric, kill rule, result, feedback, and next move.
6. The dashboard's dark visual direction, top-level five-section navigation,
   plain-language intent, and direct decision buttons are good foundations.
7. The Master Plan correctly values operator simplicity, commercial evidence,
   controlled autonomy, and continuous improvement.
8. No active-source API key was found. The runtime remains loopback-only and
   live flags are off.

## Critical Findings

### 1. The replacement runtime is not durably versioned

All current `src/`, `public/`, and `test/` files are untracked. Git currently
shows the old Claude-era surface as 87 deletions, alongside 10 modifications and
the replacement runtime as untracked content. The latest commit predates the
new runtime.

This is the first practical blocker. A disk failure, mistaken cleanup, or bad
edit can lose the current system without a trustworthy rollback point.

Required response: classify the current files, remove private/generated noise,
create one clean baseline commit, configure an off-machine remote, and prove a
fresh checkout before paid execution.

### 2. Tests can corrupt operator deliverables

Tests isolate SQLite under a temporary directory, but `CONFIG.rootDir` remains
the real repository. Tests created with `createFiles: false` still point at
project-relative deliverable paths. If a matching real file exists, the agent
runner appends test output to it.

Confirmed examples:

- Premium Notion decision pack: about 2.34 MB and 348 repeated run sections;
- Compact Desk Cable decision pack: about 0.49 MB and 124 repeated sections;
- the active deliverables directory contains roughly 96,000 lines of generated
  Markdown;
- duplicate `(2)` files are created instead of updating a canonical artifact.

`src/runtime/planner.js` creates filename variants and
`src/runtime/agent-runner.js` blindly appends sections without an idempotency
key. This must be fixed before routine testing resumes in the active checkout.

Two seeded dashboard outputs also point at files that do not exist:
`deliverables/digital-products/pilot-concept-pack.md` and
`deliverables/digital-products/unit-economics-snapshot.md`.

### 3. Live approval and cost claims are not yet trustworthy

Before any live tool or model use:

- an approval must be immutably tied to the exact task, worker, provider, model,
  evidence fixture, tool, parameters, and maximum cost;
- the SDK must enforce the intended output/turn limits;
- concurrent work must not be able to reserve the same budget twice;
- a completed provider call must not record its estimate as `actual` cost;
- a failed or timed-out provider call must be `cost unknown` until reconciled,
  not automatically `zero spend`;
- approved work blocked on missing credentials needs a tested recovery route.

Localhost binding reduces immediate exposure, but state-changing HTTP and
WebSocket routes have no identity or origin boundary. That is acceptable only
for isolated local dry-run development. It is a hard blocker before remote
access, mobile control, or meaningful live tools.

### 4. The first AI pilot is not yet a valid Demand Validator test

The current SDK path creates one Agent, exposes no tools, allows two turns, and
returns structured output. That is useful as a provider-path proof.

However:

- the protected baseline and model-comparison fixture are not actually supplied
  to the model;
- with no research tool, the worker cannot collect demand evidence;
- successful output is marked as live evidence even when it is only model
  reasoning;
- fallback text is inserted before evaluation, making contract checks partly
  circular;
- stored role criteria are not independently applied to commercial quality;
- promotion labels can imply readiness before Daniel has judged usefulness.

The honest first pilot is therefore a reasoning-on-versioned-evidence test. It
should compare one provider-backed answer with one protected baseline, check
unsupported claims and commercial usefulness independently, reconcile cost, and
stop. Live demand validation comes later when a controlled research tool is
deliberately attached.

### 5. Operational signals mix proof data with business truth

The current database is structurally healthy, but its operating story is not:

- zero revenue;
- all recorded model calls are dry-run/not-called;
- three experiments appear `running` even though their execution packs have not
  been used;
- the only commercial result is synthetic browser QA data, not buyer evidence;
- separate result and feedback submissions create near-duplicate learning
  cycles;
- monitor cycles repeatedly create new open findings for the same unresolved
  condition and never reconcile findings that disappear.

Proof, demonstration, test fixture, manual observation, imported platform data,
and reconciled payment data need explicit provenance. Only verified evidence
should improve a venture score or appear as commercial performance.

### 6. Multi-venture operation exists mainly in names and tables

There is one seeded venture and no venture service, selector, lifecycle, or
portfolio allocation. Normal planned workflows are written with
`venture_id = NULL`. Budgets, integrations, scheduler capacity, and queue order
are global. The dashboard chooses the first workflow and can label it Digital
Products through a fallback.

Do not build parallel venture scheduling yet. First make venture ownership
mandatory for all operational work and run exactly one active venture until a
real loop proves repeatable demand.

## Complexity And Clutter

### Runtime

- 43 tables exist before the first provider-backed worker run.
- 11 specialist worker definitions, 39 controlled tools, model-readiness packs,
  rehearsals, comparison packets, eval fixtures, and failure catalogs exist.
- every normal command expands into roughly 11 specialist tasks and three or
  four overlapping documents.
- protected workers mostly produce deterministic template text, not independent
  AI judgement.
- `GET /api/state` builds and returns overlapping raw and derived models, mutates
  readiness state while reading, and broadcasts the full payload after changes.

The control records are useful. The problem is activating and displaying all of
them before one worker has proved value. Keep most of this internal and dormant.

### Dashboard

Real-browser review found:

- at 1280x720, the main command control is clipped and nested scrollbars appear;
- Business Tests combines four old pages into one 2,000+ pixel workspace;
- System combines five old pages into one workspace;
- AI Team renders 52 articles and 58 buttons, including technical readiness,
  model packs, fixtures, traces, playbooks, and all 11 workers;
- the empty detail rail permanently consumes about 286 pixels;
- the Decisions page repeats the same approval in the decision card and history
  with duplicate actions;
- labels such as `Check Schedule` conceal that the action executes due jobs;
- the UI has no real venture context;
- mobile layout is not usable yet, which is acceptable only because desktop is
  the declared priority.

The five navigation labels are good. The content behind them still needs to be
designed as five coherent operator workspaces rather than aliases over eleven
legacy surfaces.

### Documents And Historical Material

- the Master Plan is directionally sound but its Stage 1 status has become a
  long feature inventory;
- the Build Log is over 2,000 lines and contains historical `Next Best Work`
  sections alongside current ones;
- Plan 1 and Plan 2 are completed implementation history and should eventually
  be folded into the Master Plan, then archived;
- `public/design-lab.*` is an obsolete prototype not linked by the live UI;
- the active POD venture conflicts with digital-products-first sequencing;
- the old ideas tracker is stale and describes system tooling rather than buyer
  opportunities;
- legal/tax/ABN files remain active despite Daniel's archive instruction and
  contain privacy-bearing identifiers;
- Claude-era logs remain beside the new database-backed event system;
- the archive contains a retired dependency tree, browser captures, databases,
  logs, and a full session transcript that do not all need to live in Git.

## Commercial Reality

The current commercial chain is:

| Stage | Current state |
| --- | --- |
| Discover buyer problems | Dormant; no current opportunity cadence |
| Validate demand | Templates, protected assumptions, or manual data |
| Create offer | Modeled well, not market-proven |
| Sell | No tested checkout/channel path |
| Fulfil | No tested delivery/support path |
| Learn | Software exists; evidence quality needs strengthening |
| Scale | Policies only |

Candidate ranking and profit labels are too optimistic. Current economics omit
or simplify platform fees, payment fees, product cost, subscriptions, refunds,
tax treatment, and Daniel's time. Manual clicks/leads can improve scores without
source evidence.

The practical operating unit should be one Venture Case containing:

- venture and owner;
- buyer and painful problem;
- offer and price;
- channel and buying action;
- source-linked evidence;
- full contribution economics;
- one active experiment, deadline, metric, and kill rule;
- next money move;
- Daniel's decision;
- actual outcome and learning.

## Recommended Program

### Phase A - Recoverable Clean Baseline

1. Stop active-checkout test pollution and make generated artifacts idempotent.
2. Classify tracked, active, generated, historical, and private material.
3. Move legal/privacy records and the paused POD surface out of the active tree.
4. Keep one small proof fixture; archive or remove duplicate generated packs
   only after a verified snapshot.
5. Track the current runtime and lockfile, create a clean baseline commit, add an
   off-machine remote, and prove a fresh checkout.
6. Add a current `.env.example` containing names and explanations only.

### Phase B - Truth And Safety Corrections

1. Make approval scope exact and immutable.
2. Change cost states to reserved, incurred estimate, unknown, reconciled, and
   released; stop displaying estimates as actual.
3. Add provider deadlines, unknown-outcome handling, and a recovery path for
   approved work blocked on setup.
4. Add versioned database migrations and one tested backup/restore procedure.
5. Reconcile monitor findings by stable issue instead of appending duplicates.
6. Keep local-only access; add identity/origin controls before remote use.

### Phase C - Simplify The Operating Model

1. Permit one active venture, one active offer, and one active experiment.
2. Make `venture_id` mandatory for new operational work.
3. Replace eleven visible worker steps with three internal work packages:
   Evidence, Venture Execution, and Controller/Quality.
4. Produce one canonical operator pack per decision, generated on demand.
5. Separate test/demo data from real business data and require source evidence.
6. Use six venture states: candidate, validating, selling, fulfilling, scaling,
   and paused/killed.

### Phase D - Operator Cockpit Redux

1. Command Center: one attention item, one money move, active test, venture risk,
   spend, and hard stops.
2. Decisions: true approvals and consequential handoffs only; Reviews,
   Suggestions, and History are separate views.
3. Business Tests: a venture-scoped pipeline with Plan, Ready, Running, Results,
   and one drawer containing run sheet, evidence, scorecard, and learning.
4. AI Team: show the core crew, current assignment, proven level, blocker, and
   next action; keep traces, fixtures, playbooks, and model setup in technical
   details.
5. System: show health and urgent faults first, with Queue, Spend, Connections,
   Outputs, and Activity as local tabs.
6. Replace the permanent inspector with an on-demand drawer.
7. Make action labels state the consequence, for example `Run Due Maintenance`
   rather than `Check Schedule`.

### Phase E - One Honest AI Pilot

1. Use Demand Validator only.
2. Pin the Agents SDK path and disable fallback for the acceptance run.
3. Supply one versioned evidence fixture and the protected baseline.
4. Use no external tools and no side effects.
5. Enforce a small output/turn limit and exact approval scope.
6. Independently check evidence use, unsupported claims, confidence,
   usefulness, trace correlation, and cost.
7. Let Daniel choose request changes, repeat once, promote for one narrow use, or
   stop.

This follows official OpenAI guidance to start with one specialist and add
handoffs, tools, sessions, and guardrails only as the use case proves it needs
them.

### Phase F - Close One Real Commercial Loop

1. Choose one buyer, problem, small digital product, price, and channel.
2. Build the minimum product plus a real checkout and delivery path.
3. Let the system prepare the evidence, copy, run sheet, and result capture.
4. Daniel approves one bounded market-contact batch.
5. Record source-linked views, replies, payments, refunds, costs, and time.
6. Continue, revise, or kill from reality.
7. Only then expand tools, worker autonomy, channels, or ventures.

## Deliberately Deferred

These are useful later but should not block the first proof:

- live collaboration among all 11 agents;
- SDK handoffs and resumable SDK sessions;
- multiple concurrent ventures;
- multi-process worker leasing and sophisticated queue fairness;
- Slack, ClickUp, Xero, Gelato, Etsy, and mobile control;
- automated publishing, customer replies, or fulfilment;
- elaborate eval catalogs and promotion scoring for every worker.

## Questions For Daniel

The recommended answer appears after each question so Daniel can accept it or
replace it.

### Business Direction

1. For the next 60 days, which wins when system-building and revenue-testing
   compete? Recommended: revenue-testing after the minimum safety fixes.
2. Should Jarvis run only one active venture until it makes repeatable sales?
   Recommended: yes.
3. Is digital products still the only active pilot, with POD explicitly parked?
   Recommended: yes.
4. Do you want Jarvis to discover opportunities on a weekly cadence, or mainly
   develop ideas you give it? Recommended: both, with a short ranked weekly list.
5. What would count as a successful first commercial proof: first sale, three
   sales, break-even, or a repeatable conversion rate? Recommended: at least
   three independent paid buyers and positive contribution margin.
6. What is the maximum time an idea may stay in validation without a sale?
   Recommended: two bounded test cycles or four weeks, whichever comes first.

### Daniel's Role

7. Which actions must always stop for you? Recommended: spend, publishing,
   customer commitments, account changes, legal/compliance, refunds/disputes,
   and money movement.
8. After proof, may Jarvis do low-risk internal work without asking, including
   research synthesis, drafts, scoring, and experiment preparation?
   Recommended: yes.
9. For the first market test, are you willing to make a small number of manual
   posts or messages if Jarvis prepares everything? Recommended: yes, once, to
   prove the loop before automating it.
10. How much operator time per week should the system be designed around?
    Recommended starting assumption: 30 minutes on weekdays and one 60-minute
    weekly review.
11. Do you want one bundled decision card with recommendation, evidence, upside,
    risk, cap, and Approve / Change / Stop? Recommended: yes.
12. Should internal worker handoffs ever ask you for a decision when they do not
    change spend, risk, public action, or strategy? Recommended: no.

### Cockpit Preferences

13. Should the first screen be a portfolio summary with one active-venture
    focus, or open directly into the active venture? Recommended: portfolio
    summary with one clearly selected active venture.
14. Should Reviews and Suggestions be separate from true Decisions?
    Recommended: yes.
15. Should AI traces, fixtures, playbooks, model setup, raw queues, and event
    ledgers be hidden under Technical Details by default? Recommended: yes.
16. When nothing needs you, what should the main screen emphasize: current test,
    next money move, or system health? Recommended: next money move and current
    test, with health reduced to one quiet status line.
17. Do you prefer a right-side detail drawer, a centered modal, or a full page
    for deeper review? Recommended: right-side drawer for normal items and a
    full page only for substantial evidence/PDF review.
18. Which alerts deserve an interruption rather than waiting in the dashboard?
    Recommended: spend/risk breach, failed public action, customer dispute,
    unknown provider cost, or a deadline that blocks revenue.

### AI Team

19. Should Daniel see a core crew of three or four workers while specialist roles
    stay internal? Recommended: yes - Chief of Staff, Evidence, Venture
    Execution, and Controller/Quality.
20. Is Demand Validator still the first provider-backed worker? Recommended:
    yes, but as reasoning on a supplied evidence fixture first.
21. What would make the first AI output genuinely useful to you: faster review,
    better evidence challenge, clearer recommendation, or all three?
    Recommended acceptance rule: materially improve at least two.
22. Should a worker require your explicit promotion before it can repeat even a
    capped live-model task automatically? Recommended: yes until at least five
    useful, reviewed runs.

### Evidence, Economics, And Records

23. Which commercial data sources do you already control: store, checkout,
    email list, social account, communities, or none? This determines the first
    realistic channel test.
24. What budget caps feel comfortable for one AI pilot, one market test, and one
    month? Suggested starting points: A$1 AI pilot, A$25 market test, A$100
    monthly while pre-revenue.
25. Should profit include platform/payment fees, refunds, product costs, paid
    tools, and a visible value for your time? Recommended: yes; show cash profit
    and time-adjusted contribution separately.
26. Should manually entered results require a source link, screenshot, receipt,
    or explicit `operator observation` label? Recommended: yes.
27. Should legal, ABN, tax, and entity records be moved to a private historical
    folder outside the active runtime and redacted from Git? Recommended: yes,
    matching the earlier archive instruction.
28. Should the old POD venture, design lab, stale ideas tracker, Claude logs, and
    completed session plans be archived after the clean baseline is secured?
    Recommended: yes.
29. How long should raw traces, screenshots, approval tokens, and generated packs
    be retained? Recommended: short default retention for raw artifacts, durable
    retention only for decisions, verified evidence, costs, and outcomes.
30. Where should the off-machine recovery copy live: private GitHub, another Git
    host, or a private backup location? Recommended: private Git remote plus an
    encrypted database backup.

## Verification Performed

- Read the Master Plan, Build Log, active decisions/plans, current source,
  dashboard, tests, active business files, and archive structure.
- Inspected the main runtime database read-only; integrity was `ok` and no
  foreign-key violations were reported.
- Ran the active test suite in a disposable repository copy: 62 passed, 0
  failed, in about 66 seconds.
- Started an isolated server with a fresh database and scheduler disabled.
- Confirmed `GET /api/health` returned healthy protected-mode state.
- Inspected Command Center, Decisions, Business Tests, AI Team, and System in a
  real browser at desktop sizes. No browser console warnings or errors appeared.
- Invoked no live provider, publish, account, customer, money, or approval
  action. No paid spend occurred.
- Reviewed current official OpenAI Agents SDK and agent-evaluation guidance.

Official references:

- OpenAI Agents SDK guide:
  https://developers.openai.com/api/docs/guides/agents
- OpenAI agent evals guide:
  https://developers.openai.com/api/docs/guides/agent-evals

## Immediate Recommendation

Do not add more agents, integrations, readiness panels, tables, or generated
documents now. Complete Phases A and the pilot-critical part of B, implement the
smaller cockpit and canonical Venture Case, then run the one Demand Validator
provider proof. Immediately follow it with one real digital-product commercial
loop so the next engineering work is shaped by buyer reality rather than more
internal simulation.
