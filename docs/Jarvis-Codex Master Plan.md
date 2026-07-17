# Jarvis-Codex Master Plan

Last updated: 2026-07-17
Status: active source of truth
Owner: Daniel
Technical steward: Codex

## Purpose

Jarvis is a local, desktop-first AI business operating system. Its purpose is
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

Jarvis keeps responsibility for:

- venture and workflow state;
- exact approvals and autonomy levels;
- costs, accounting, evidence, and results;
- queue ownership, retries, recovery, and unknown outcomes;
- operator-facing outputs and dashboard truth;
- evaluation records and durable audit history.

The OpenAI Agents SDK is the first-class live worker runner. It manages the
specialist agent loop inside Jarvis's boundaries. The Responses API remains a
lower-level provider path where direct calls or read-only research are simpler.
Neither provider layer may bypass Jarvis approvals, limits, persistence, or
evaluation.

Autonomous Agent Operations Foundation Phase 1 adds a common assignment,
receipt, audit, monitoring, and review contract around those provider paths. It
does not replace Jarvis state with model memory or make a visible worker live by
default.

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

The active commercial worker is the Demand Validator. Its job is to determine
whether evidence justifies a small market test, identify counterevidence and
assumptions, and recommend the smallest useful next step. It does not invent a
finished product or publish anything. It must first work from supplied evidence.
Read-only live web research is a separate capability with a fresh, single-use
A$2 approval, a three-search limit, and a 120-second deadline. Validated findings
flow through the Chief of Staff only when the venture stage requires them.

Product Builder and Quality Reviewer remain supervised in Phase 1. Product
Builder cannot publish or approve its own output; Quality Reviewer can inspect
only exact approved inputs and cannot generate, alter, publish, or approve them.

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

## Safety And Autonomy

- External actions default to locked.
- Every paid or consequential action is bound to its exact venture, task,
  worker, provider, model, input fingerprint, tools, parameters, limits, cost,
  and external effects.
- Approvals are single-use, expire, and become invalid after scope changes.
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
- Provider-side storage for business or personal data and ongoing sensitive
  worker operations remain blocked until Daniel approves a retention and privacy
  schedule.

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

- Maintain the recoverable, clean first-use baseline.
- Operate against the fixed 11-worker Phase 1 contract. Its bounded assignment,
  receipt, audit, monitoring, and model-routing foundation passed on
  2026-07-17.
- Use the cockpit to prepare one Evidence Brief that ranks three plausible
  digital-product opportunities.
- Run the prepared Demand Validator supplied-evidence decision first. It is
  waiting for Daniel's exact approval and remains no-tool, one-turn, and capped.
- Only after that result is accepted, offer Daniel one separately approved,
  capped live-web proof; do not treat the supplied-evidence approval as reusable.
- Record Daniel's retention and privacy decision before ongoing live research or
  sensitive data use widens.
- Present one concise opportunity-selection decision to Daniel.

### Next

- Turn the selected opportunity into the smallest useful product and Publish
  Pack through supervised Product Builder and Quality Reviewer work.
- Daniel completes any required private Gumroad account and KYC action and
  approves initial publication.
- Run no more than three organic posts across two evidence-selected channels.
- Measure for 14 days or 50 qualified product views.
- Continue, revise once, or stop according to buyer evidence and contribution.

### Later

- Promote only exact capabilities that earn five reviewed successes.
- Add image generation, video, audio, or paid media only when a proven
  commercial bottleneck requires it.
- Add a second venture only after repeatable first-venture results.
- Expand fulfilment and customer operations after demand is proven.
- Consider remote/mobile operation or dynamic workers only through separate
  architecture, security, privacy, and release decisions.

## Release Gates

Status: satisfied for the clean first-use foundation on 2026-07-17. This is not
the Autonomous Agent Operations Phase 1 release; its separate gates remain
active. Future changes that affect either boundary must repeat proportionate
proof.

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

- `docs/Jarvis-Codex Build Log.md`: current decisions, proof, and next work.
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
