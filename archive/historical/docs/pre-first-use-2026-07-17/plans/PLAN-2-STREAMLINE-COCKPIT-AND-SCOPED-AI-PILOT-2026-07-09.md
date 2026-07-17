# Plan 2 - Streamline Cockpit And Scoped AI Pilot Review

Date: 2026-07-09
Status: implemented 2026-07-09
Owner: Operator
Maintainer: Codex

## Summary

Plan 2 makes Jarvis-Codex easier to command before the first real
provider-backed AI worker run.

The system now has the Agents SDK-first `AgentRuntime` facade, approval gates,
cost rails, trace/eval records, model-call records, Workbench proof, and
provider readiness checks. The next risk is not missing architecture; it is
operator overload. The cockpit must show what matters in ordinary business
language before live AI output adds another layer of evidence to review.

Plan 2 therefore does two things:

1. Simplify the desktop cockpit into a business command surface.
2. Add a small AI pilot review layer so the first Demand Validator live run can
   be judged in one place before any wider AI Team execution.

This plan does not connect new external services. It does not enable autopilot.
It does not run live provider spend by itself. It prepares the operator surface
and review workflow needed to make the first live AI pilot safe, useful, and
easy to judge.

## Implementation Result

Plan 2 is now implemented as a lightweight cockpit/read-model layer, not a new
source of truth.

- Added derived `operatorCockpit` runtime state for the first-screen command
  summary.
- Added derived `aiPilotReview` runtime state for the Demand Validator pilot.
- Simplified dashboard navigation into five operator sections: Command Center,
  Decisions, Business Tests, AI Team, and System.
- Added AI Pilot Review cards on Command Center and AI Team.
- Added pilot review decision recording for Mark Useful, Request Changes,
  Repeat Capped Test, Promote Narrow Use, and Stop Pilot after a live output is
  available.
- Preserved the existing approval, cost, trace, eval, Workbench, model-pack,
  decision-inbox, and dashboard state rails.
- No live model call, live spend, publishing, customer contact, account action,
  legal/compliance decision, or money movement was enabled by this plan.

## Why This Is Needed

The current system has many correct rails, but the operator should not have to
inspect readiness panels, model packs, worker traces, costs, approvals,
scorecards, and workflow records just to answer: "Was this AI worker useful, and
should we let it do more?"

The scoped AI pilot review layer is the answer to that problem.

It is a lightweight cockpit view, not a new bureaucracy. It gathers the minimum
evidence needed to review one live AI worker pilot:

- protected baseline output
- live Agents SDK output
- business decision contract quality
- trace and eval result
- estimated cost and billing status
- risk and hard-stop status
- operator usefulness verdict
- recommended next action: revise, repeat, promote narrow use, or stop

Its purpose is to prevent broad AI rollout before one specialist worker has
proved real value under control.

## Definition: Scoped AI Pilot Review Layer

The scoped AI pilot review layer is a derived dashboard/runtime surface for one
approved worker pilot at a time.

It should answer, on one screen:

- What worker ran?
- What business question did it answer?
- What did the protected baseline say?
- What did the live Agents SDK run say?
- Did the output satisfy the business decision contract?
- Did the trace/eval/cost evidence pass?
- Did the answer help the operator make a better commercial decision?
- What should happen next?

It should not be:

- a new generic analytics warehouse
- a complex experiment platform
- a second Workbench
- a place to hide raw technical detail
- a reason to delay real testing forever

The layer is needed, but only if kept small. It exists to make the first live AI
run reviewable in minutes, not to create another manual pipeline.

## Non-Negotiable Product Rules

- Dark default, desktop-first.
- Operator sees ordinary business language, not backend labels.
- First screen answers: what needs attention, what is the money move, what is
  blocked, and what can I decide now?
- Critical controls are reachable within two clicks.
- Detailed proof remains available but moves into drawers or System.
- No live provider run starts from Plan 2 unless credentials, live flag, budget,
  and explicit approval are already in place.
- No external tool use, customer contact, publishing, account action,
  legal/compliance decision, or money movement is allowed.
- New durable tables are avoided unless existing state cannot answer the review
  question. Prefer derived `operatorCockpit` and `aiPilotReview` state.

## Phase 1 - Cockpit Purpose Filter

Review every current dashboard tab, panel, and decision path against five jobs:

1. Command work.
2. Decide the next money move.
3. Run or review a business test.
4. Inspect AI Team readiness and pilot evidence.
5. Check system risk, spend, and blocked actions.

Classify current surfaces:

- Primary cockpit: daily operator control.
- Detail drawer: useful after clicking for proof.
- System/admin: needed for health, logs, setup, and debugging.
- Archive/defer: not useful for current digital-product and AI pilot work.

Outcome:

- a simplified cockpit map
- no removal of runtime proof
- clear decision on what moves behind drawers
- no new tabs unless they replace multiple confusing ones

## Phase 2 - Operator Cockpit State

Add a derived `operatorCockpit` state object from existing runtime state.

It should include:

- top decision waiting
- current money move
- active business test
- AI Team readiness summary
- pilot review status
- latest result and learning
- spend and budget state
- blocked external actions
- system alerts

This should not create a new source of truth. It is a clean read model for the
dashboard.

## Phase 3 - Desktop Cockpit Redesign

Simplify the dashboard into five primary sections:

- Command Center
- Decisions
- Business Tests
- AI Team
- System

First screen layout:

- top attention band: the one thing requiring operator action
- money move card: upside, evidence, risk, cap, next action
- business test card: current pilot/test status and result shortcut
- AI pilot card: protected proof, live readiness, pilot review status
- spend/risk strip: budget, live locks, hard stops, alerts

Move these into detail drawers or System:

- long event feeds
- raw readiness checklists
- full model connection packs
- detailed trace lists
- low-level integration metadata
- old technical labels

Keep direct buttons for:

- Approve
- Request Changes
- Deny
- Run Work Queue
- Run Protected Team Drill
- Prepare Review Pack
- Record Result
- Open AI Pilot Review

## Phase 4 - AI Pilot Review Layer

Add a derived `aiPilotReview` surface for the first Demand Validator pilot.

Before live run:

- show selected worker: Demand Validator
- show business question and fixture
- show protected baseline status
- show cost cap and hard stops
- show provider readiness
- show approval state
- show what approval means in plain language

After live run:

- compare protected baseline and live output
- show contract pass/fail
- show trace/eval status
- show estimated cost and billing reconciliation state
- show risk flags and hard stops
- show operator usefulness question
- recommend one of:
  - revise prompt/fixture
  - repeat one capped run
  - promote Demand Validator to narrow capped use
  - stop live worker testing for now

Operator controls:

- Mark Useful
- Request Changes
- Repeat Capped Test
- Promote Narrow Use
- Stop Pilot

Any promote/repeat path remains approval-gated.

## Phase 5 - First Real AI Pilot Preparation

Do not run the live provider call as part of cockpit work unless the operator
explicitly says to proceed and provider readiness passes.

Prepared pilot:

- worker: Demand Validator
- runner: OpenAI Agents SDK through `AgentRuntime`
- scope: one business validation task
- input: one existing model-comparison packet or protected proof fixture
- cap: tiny approved model-call cap
- tools: no external tools
- output: `jarvis_worker_business_decision_v1`
- review: AI Pilot Review layer

Chief of Staff live test remains second, not first. It only becomes relevant
after Demand Validator proves useful output under control.

## Out Of Scope

- Mobile redesign.
- New worker roles.
- New broad orchestration framework.
- Live email.
- POD, Gelato, Etsy, Xero, or paid asset generation.
- Autopilot promotion.
- Customer contact or publishing.
- Legal/compliance determinations.
- Money movement.

## Acceptance Criteria

Cockpit:

- Operator can understand the next required action in 10 seconds.
- Top decision includes money move, evidence, risk, upside, and cost cap.
- Dashboard text uses ordinary business language.
- No critical action requires hunting through raw logs, model packs, or events.
- No desktop horizontal overflow.
- Browser console has no warnings or errors.

AI pilot review:

- Demand Validator pilot state is visible before and after the live run.
- Protected baseline and live output can be compared in one place.
- Trace, eval, cost, risk, and hard-stop status are visible without reading raw
  database records.
- Operator can choose revise, repeat, promote narrow use, or stop.
- No live action occurs without approval and readiness gates.

Tests:

- Unit/API coverage for `operatorCockpit` derived state.
- Unit/API coverage for `aiPilotReview` pre-run and post-run states.
- Existing live worker tests remain passing.
- Browser proof covers Command Center, Decisions, AI Team, AI Pilot Review, and
  System at desktop width.

## Recommended Execution Order

1. Build `operatorCockpit` derived state and tests.
2. Redesign dashboard navigation into the five-section cockpit.
3. Move low-level proof into drawers/System without deleting it.
4. Build `aiPilotReview` derived state for Demand Validator.
5. Add dashboard AI Pilot Review card/drawer.
6. Run full backend tests and browser proof.
7. Update master plan and build log.
8. Only then ask whether to proceed to the first real provider-backed Demand
   Validator run.

## Assumptions

- Plan 1 is complete: `AgentRuntime` facade exists and SDK path is stub-tested.
- The first commercial pilot remains digital products.
- The first live AI worker pilot remains Demand Validator.
- Responses API remains direct provider infrastructure for live research/search
  and fallback direct model calls.
- Existing approval, cost, trace, eval, Workbench, and dashboard state rails are
  preserved.
