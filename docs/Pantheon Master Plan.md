# Pantheon Master Plan

Last updated: 2026-07-18
Status: active source of truth
Owner: Daniel
Technical steward: Jarvis (Codex)

## Purpose

Pantheon is a local, desktop-first AI business operating system. Its purpose is
to let a supervised team of specialist AI workers investigate, build, launch,
measure, and improve online ventures while Daniel remains the owner and final
decision-maker for consequential actions.

The system is successful when it produces profitable real-world results with
low operator effort. Internal activity, documents, traces, and elaborate
workflows are useful only when they improve demand evidence, offer quality,
distribution, conversion, fulfilment, feedback, or unit economics.

## First Commercial Proof

The first proof is deliberately narrow:

- one active digital-product venture;
- one commercial test at a time;
- Gumroad Direct for initial checkout and delivery;
- a faceless and voiceless public brand;
- at least three independent paying customers;
- positive cash contribution after fees, refunds, external spend, and tools;
- normal operator involvement no higher than eight hours per week;
- no second venture until the first loop proves itself.

The detailed execution directive is
`docs/plans/FOUNDATION-TO-FIRST-REVENUE-EXECUTION-PLAN-2026-07-14.md`.
The active worker-operations contract is
`docs/plans/AUTONOMOUS-AGENT-OPERATIONS-FOUNDATION-PHASE-1.md`.

## Operating Model

The commercial loop is:

1. Define the buyer, painful problem, offer, channel, price, and evidence gap.
2. Ask the smallest useful commercial question.
3. Let the appropriate worker analyse supplied evidence or perform an exactly
   approved, capped research action.
4. Present Daniel with one concise recommendation when a material choice is
   required.
5. Prepare the smallest real-world test and its stop or revise rule.
6. Record what actually happened, including costs and evidence provenance.
7. Compare expected and actual results, record the learning, and improve the
   next action.

Every meaningful action must carry a hypothesis, expected measure, deadline,
actual result, learning, and next money move. A task without a commercial
purpose is support work and must not crowd the operator view.

## System Boundaries

Pantheon keeps responsibility for:

- venture and workflow state;
- exact approvals and autonomy levels;
- costs, accounting, evidence, and results;
- queue ownership, retries, recovery, and unknown outcomes;
- operator-facing outputs and dashboard truth;
- evaluation records and durable audit history.

The OpenAI Agents SDK is the first-class live worker runner. It manages the
specialist agent loop inside Pantheon's boundaries. The Responses API remains a
lower-level provider path where direct calls or read-only research are simpler.
Neither provider layer may bypass Pantheon approvals, limits, persistence, or
evaluation.

Autonomous Agent Operations Foundation Phase 1 adds a common assignment,
receipt, audit, monitoring, and review contract around those provider paths. It
does not replace Pantheon state with model memory or make a visible worker live by
default.

Task-scoped context snapshots now bind each live worker to the exact venture,
record classes, purpose, task, and approval it needs. Chief of Staff may prepare
at most one bounded assignment for one existing specialist; it cannot create
workers or grant authority. Product, copy, and distribution outputs are frozen
for an independent Quality Reviewer check before they can become ready for
operator use.

Task-scoped does not mean information-starved. A worker may receive the
venture's relevant finance, production, legal, customer, evidence, and operating
records when its exact assignment needs them. Pantheon records which classes were
supplied and withholds unrelated records, credentials, raw identity documents,
and direct identifiers unless the assignment has a recorded need and the
applicable approval and retention rules permit them.

Pantheon monitoring is part of the runtime, not a feature that depends on this
Codex conversation being open. Jarvis can inspect those durable records whenever
needed. Dashboard actions, assignments, provider calls,
tools, approvals, outputs, costs, evaluations, and failures write durable
records for scheduler-backed checks and later engineering review. Chief of
Staff may coordinate the fixed team one bounded specialist assignment at a
time; runtime-created teams remain a later capability.

Every provider-bound task attempt now owns exact, immutable links to its agent
run, model call, evaluation, tools, cost, and append-only receipt chain. Missing
usage is recorded as unknown rather than zero, missing approved provider-tool
activity stops for review, and a terminal failure still receives an evaluation.
An operator usefulness verdict is committed atomically with its new receipt, so
the dashboard cannot show a review that is absent from the execution evidence.

## AI Team

The Phase 1 business roster is fixed at 11 workers, grouped for clarity:

- Command: Chief of Staff.
- Evidence: Demand Validator and Opportunity Scout.
- Venture: Offer Architect, Product Builder, Copy and Conversion Agent, and
  Distribution Agent.
- Control and Learning: Customer Voice Agent, Finance and Unit Economics Agent,
  Growth Analyst, and Quality Reviewer.

The fixed roster is not eleven simultaneous provider processes. Workers cannot
create workers, change the roster, inherit another worker's approval, or widen
their own tools. Dynamic agents require a later decision and release gate.

The active commercial starting pair is Opportunity Scout followed by Demand
Validator. Scout searches broadly and ranks attributable opportunities.
Validator determines whether evidence justifies a small market test, identifies
counterevidence and assumptions, and recommends the smallest useful next step.
Neither invents a finished product or publishes anything. Read-only web research
is a separate bounded capability. Validated findings flow through Pantheon's
commercial supervisor and Chief of Staff only when the venture stage requires
them.

Product Builder and Quality Reviewer remain supervised in Phase 1. Product
Builder cannot publish or approve its own output; Quality Reviewer can inspect
only exact approved inputs and cannot generate, alter, publish, or approve them.
The guarded Product Builder workspace can prepare one low-cost OpenAI image
request, store exactly one validated local PNG, JPEG, or WebP asset, show it in
the dashboard, and stop for a separate Quality Reviewer approval. Preparing the
request makes no model call.

## Operator Experience

The cockpit has five stable sections:

- Command Center: business position, Important Work, next money move, current
  test, team pulse, cash, and system health.
- Decisions: consequential choices, with Reviews, Suggestions, and History kept
  separate.
- Business Tests: Plan, Ready, Running, and Results.
- AI Team: every worker plus truthful Live Runs for genuine provider execution.
- System: health, queue, spend, connections, outputs, and activity.

Normal screens use ordinary business language. Technical identifiers, traces,
and diagnostics remain available on demand. Live Runs shows structured inputs,
evidence, tools, sources, conclusions, timing, tokens, cost, errors, and evals;
it never claims or exposes private chain-of-thought.

The normal decision journey is sequential: show one item that needs Daniel,
open one spacious review surface, record whether the result is clear enough,
then reveal the next business choice. Cost limits, prohibited actions, and the
effect of each button must be stated beside the decision. Internal terms such as
approval gates, fixtures, dry runs, scheduler jobs, and runtime handoffs stay in
technical details rather than the primary operator flow.

All operator money is labelled explicitly in Australian dollars. Activity hides
duplicate internal notification records and translates runtime actors into
business language. Connections shows only the current first-revenue services:
the OpenAI AI Team, separately governed live research, and Gumroad Direct.

## Safety And Autonomy

- External actions default to locked.
- Every paid or consequential action is bound to its exact venture, task,
  worker, provider, model, input fingerprint, tools, parameters, limits, cost,
  and external effects.
- Approvals are single-use, expire, and become invalid after scope changes.
- Pending AI-work decisions created before a worker-policy update are
  superseded and regenerated before execution. The replacement always requires
  a fresh operator decision; an old click cannot approve the new scope.
- Provider timeouts and ambiguous dispatches become unknown outcomes for review,
  never automatic retries.
- Every worker attempt must leave a local receipt and linked audit events. Live
  attempts also retain the available provider IDs, tools, sources, usage, cost
  state, outcome, and review state without claiming private chain-of-thought.
- Luna, Terra, and Sol are implemented per-assignment routes. Luna handles
  narrow low-ambiguity work, Terra is the normal business worker, and Sol
  handles deep research, consequential judgement, and quality escalation.
  The exact model and reason are selected before approval, recorded in the
  descriptor and receipt, and cannot silently fall back after approval. Model
  choice never grants authority.
- Internal analysis or drafting can be promoted only after five consecutive
  successful reviewed runs for that exact capability and Daniel's approval.
- Read-only paid research has its own five-run sequence and fixed caps.
- Publishing, customer contact, public strategy, and spend remain
  recommendation-plus-approval actions.
- Legal agreements, account creation, disputes, compliance determinations, and
  money movement remain hard stops.
- No publishing, customer contact, account action, legal decision, or money
  movement is authorised by a general dashboard instruction.
- Remote/mobile operation and runtime-created workers remain deferred.
- The approved data-protection schedule is active. It keeps finance, tax,
  contract, money, compliance, and linked audit evidence for seven years;
  accepted venture work while active plus three years; routine drafts and
  diagnostics for ninety days; and encrypted backups on the existing
  seven-daily/four-weekly rotation. Provider response and trace-content storage
  remain off by default, sensitive provider storage is forbidden, and
  destructive cleanup always remains a separate previewed action.

## Financial Truth

- Australian dollars are the system currency.
- Foreign-currency activity requires an AUD conversion rate and evidence.
- Reconciled cash records are immutable; corrections use a reversal or revision.
- Provider cost states are reserved, estimated incurred, unknown, reconciled,
  or released. Estimates are never displayed as actual spend.
- The pre-revenue monthly AI and tool cap is A$100.
- A no-tool worker run is capped at A$1 unless Daniel approves a different exact
  scope.
- A read-only live research run is capped at A$2.
- An optional market test is capped at A$25 and never starts automatically.

## Roadmap

### Now

- Maintain the recoverable, clean schema-20 production baseline.
- Start the first real broad opportunity scan from Command Center. Opportunity
  Scout should rank three commercially plausible online opportunities, then
  Demand Validator should challenge all three before Pantheon asks Daniel to
  choose.
- Keep the first selection focused on digital products unless evidence shows a
  materially better low-risk first proof. Other lawful venture models remain in
  discovery scope and are not permanently excluded.
- Treat the completed four-call Luna release proof as engineering evidence only.
  It proved the Agents SDK, web search, supervisor, approvals, handoffs, traces,
  evaluations, costs, source persistence, dashboard, and stop logic. It did not
  prove Pantheon's own buyer demand, conversion, margin, or revenue.
- Keep July AI and tool exposure truthful at A$1.18: A$0.05 reconciled and
  A$1.13 pending provider reconciliation. Reconcile against OpenAI billing when
  the provider total becomes available.
- Preserve one simple operator boundary: Daniel selects the venture and later
  approves protected account, publication, customer-contact, advertising, and
  spend actions. Pantheon performs the internal research, economics, product,
  quality, copy, distribution, and learning work.

### Next

- Turn the selected opportunity into a venture-specific minimum credible
  catalogue, economics case, offer, and smallest valid market test.
- Run the first paid Product Builder assignment and independent Quality Reviewer
  check. Accept only real, inspectable product files that pass functional,
  evidence, claim, and format checks.
- Prepare one concise Publish Pack. Daniel completes any required private
  Gumroad account and KYC action and approves the first publication.
- Run no more than three organic posts across two evidence-selected channels,
  then measure for 14 days or 50 qualified product views.
- Continue on three independent paid buyers and positive cash contribution;
  otherwise diagnose reach, offer, price, catalogue, conversion, and demand
  before revising once or pausing.

### Later

- Promote only exact capabilities that earn five reviewed successes.
- Use image generation, Code Interpreter, video, audio, external production
  services, or paid media when the accepted venture and quality standard
  require them, not as decorative capability demonstrations.
- Add a second venture only after repeatable first-venture results.
- Expand fulfilment and customer operations after demand is proven.
- Consider remote/mobile operation or dynamic workers only through separate
  architecture, security, privacy, and release decisions.

## Release Gates

Status: satisfied for the clean first-use and fixed-team engineering foundation
on 2026-07-18. The current release passed schema 20, 201 automated tests after a
clean install, npm advisory review, encrypted coherent-set recovery, operations
doctor, genuine four-call Agents SDK proof, real-browser desktop proof, and
in-dashboard PDF proof. The production cockpit is clean and ready for its first
real discovery run. Commercial demand, Product Builder's first paid production
assignment, Gumroad publication, buyer results, capability promotion, and every
external action retain their separate gates. Future changes must repeat proof in
proportion to their risk.

Foundation is releasable only when:

- encrypted source, database, and artifact backups restore successfully;
- a clean checkout installs, tests, starts, and passes database integrity;
- concurrent work cannot duplicate provider calls;
- approval replay, scope changes, unknown pricing, and unverified evidence fail
  closed;
- dashboard APIs require the signed local operator session;
- browser proof passes at supported desktop sizes with no console errors or
  horizontal overflow;
- the active cockpit contains no pilot decisions, outputs, runs, or test history;
- real accounting remains exact and recoverable.

## Durable Records

- `docs/Pantheon Build Log.md`: current decisions, proof, and next work.
- `docs/proofs/2026-07-18-pantheon-release-proof.md`: exact release evidence,
  costs, commercial result, and honest limitations.
- `docs/plans/PANTHEON-COMMERCIAL-OPERATING-SYSTEM-EXECUTION-PLAN-2026-07-18.md`:
  completed foundation execution directive and first-use gates.
- `docs/operating-procedures.md`: operating and recovery procedures.
- `docs/plans/AUTONOMOUS-AGENT-OPERATIONS-FOUNDATION-PHASE-1.md`: active worker
  operations scope, gates, receipt contract, and implementation boundary.
- `docs/decisions/0006-autonomous-agent-operations-foundation.md`: accepted
  fixed-team and supervised-operations decision.
- `docs/architecture/README.md`: index of current architecture records.
- `docs/commercial/GUMROAD-LAUNCH-GATE.md`: launch requirements.
- `docs/reviews/PRE-FIRST-USE-ENGINEERING-AND-SECURITY-REVIEW-2026-07-17.md`:
  current engineering review.
- `archive/historical/`: superseded plans, pilot reviews, prior logs, and legacy
  implementations retained for reference only.
