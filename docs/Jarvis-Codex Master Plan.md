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

## AI Team

All 11 workers remain visible, grouped for clarity:

- Command: Chief of Staff.
- Evidence: Demand Validator and Opportunity Scout.
- Venture: Offer Architect, Product Builder, Copy and Conversion Agent, and
  Distribution Agent.
- Control and Learning: Customer Voice Agent, Finance and Unit Economics Agent,
  Growth Analyst, and Quality Reviewer.

The active commercial worker is the Demand Validator. Its job is to determine
whether evidence justifies a small market test, identify counterevidence and
assumptions, and recommend the smallest useful next step. It does not invent a
finished product or publish anything. Validated findings flow through the Chief
of Staff to the offer, product, design, distribution, finance, and learning
workers only when the venture stage requires them.

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
- Internal analysis or drafting can be promoted only after five consecutive
  successful reviewed runs for that exact capability and Daniel's approval.
- Read-only paid research has its own five-run sequence and fixed caps.
- Publishing, customer contact, public strategy, and spend remain
  recommendation-plus-approval actions.
- Legal agreements, account creation, disputes, compliance determinations, and
  money movement remain hard stops.
- No publishing, customer contact, account action, legal decision, or money
  movement is authorised by a general dashboard instruction.

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
- Use the cockpit to prepare one Evidence Brief that ranks three plausible
  digital-product opportunities.
- Run the Demand Validator only against an explicit evidence packet or an
  separately approved A$2 read-only research scope.
- Present one concise opportunity-selection decision to Daniel.

### Next

- Turn the selected opportunity into the smallest useful product and Publish
  Pack.
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

## Release Gates

Status: satisfied for the first-use foundation on 2026-07-17. Future changes
that affect these boundaries must repeat proportionate proof.

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
- `docs/commercial/GUMROAD-LAUNCH-GATE.md`: launch requirements.
- `docs/reviews/PRE-FIRST-USE-ENGINEERING-AND-SECURITY-REVIEW-2026-07-17.md`:
  current engineering review.
- `archive/historical/`: superseded plans, pilot reviews, prior logs, and legacy
  implementations retained for reference only.
