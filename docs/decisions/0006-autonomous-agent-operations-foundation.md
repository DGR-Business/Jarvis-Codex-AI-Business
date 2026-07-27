# 0006 - Autonomous Agent Operations Foundation

Date: 2026-07-17
Status: accepted operating direction; implementation remains gated

## Current Status Update - 2026-07-22

The implementation boundary later in this decision records the state on
2026-07-17 and is historical. It is superseded where it says that model routing,
retention approval, Product Builder, or Quality Reviewer are not implemented or
not proved. Luna/Terra/Sol routing is now implemented, the data-protection plan
is active, and the fixed specialists are connected through the bounded Full
Journey. Dynamic workers, remote/mobile operation, publishing, account actions,
customer contact, and money movement remain gated.

The current execution contract is
`docs/plans/PANTHEON-FULL-JOURNEY-PROOF-AND-FIRST-PRODUCT-2026-07-22.md`.

## Decision

Jarvis will use a fixed, supervised 11-worker roster for Autonomous Agent
Operations Foundation Phase 1.

Demand Validator must prove useful work over supplied evidence before a separate
single-use approval can authorise one capped, read-only live-web proof. Every
worker attempt must leave a receipt, linked audit records, cost state, and a
monitorable outcome.

Luna, Terra, and Sol are routing intent, chosen per assignment. They do not
change worker authority. Terra is the current configured live-worker default;
Luna/Sol selection and a complete policy router are not yet implemented.

Product Builder and Quality Reviewer remain supervised. Dynamic workers and
remote/mobile operation are deferred. Ongoing live work cannot widen to
sensitive data or provider-side storage until Daniel approves a retention and
privacy schedule.

The detailed contract is
`docs/plans/AUTONOMOUS-AGENT-OPERATIONS-FOUNDATION-PHASE-1.md`.

## Context

Jarvis already has a persistent runtime, 11 visible worker definitions,
role-specific output contracts, approvals, cost controls, provider receipts,
events, and a scheduler-backed monitor. It also has a narrow Agents SDK path for
Demand Validator and guarded tool definitions for web research, image
generation, and visual review.

Those parts do not yet add up to autonomous operations. The active runtime was
reset to a clean capability streak, the search-enabled Demand Validator proof
has not been accepted, Product Builder and Quality Reviewer have not earned
live authority, and the runtime does not yet route between Luna, Terra, and Sol.
A fixed operating contract is needed before capability work continues.

## Options Considered

1. Dynamic autonomous team now

   Let workers create roles, choose tools and models, delegate recursively, and
   act whenever the runtime believes a task is useful.

2. Fixed supervised foundation

   Keep the 11-worker roster fixed, sequence one capability at a time, bind each
   live action to an exact approval, and require receipts, audit, monitoring,
   and human review.

3. Continue with one ad hoc live worker

   Keep Demand Validator as a special case without defining a common operating
   contract for the rest of the team.

Option 2 is accepted. It provides a path to useful operations without treating
prompts, worker names, or a successful pilot as authority.

## Consequences

- Phase 1 has exactly 11 business workers; the roster does not grow at runtime.
- Visibility in the AI Team does not mean a worker is live or autonomous.
- Handoffs create bounded assignments and never carry approval or tools
  implicitly.
- Supplied-evidence Demand Validator work precedes the separately approved
  A$2, three-search, 120-second live-web proof.
- Read-only live web has its own five-reviewed-run promotion history.
- Product Builder may prepare local work, but paid asset generation needs an
  exact approval and it cannot publish.
- Quality Reviewer may inspect exact approved inputs but cannot alter, publish,
  or approve them.
- Model route, reason, price, and selected model become part of the run record;
  unavailable or changed routes fail closed.
- Unknown provider outcomes are reviewed before retry.
- Remote/mobile operation, dynamic agents, and long-term model memory require
  later decisions and release gates.
- The additional records and reviews cost time and tokens. That overhead is
  accepted because it keeps spend, evidence, and authority understandable.

## Current Implementation Boundary

Already present in the repository on the decision date:

- the fixed 11-worker registry and role-specific structured output contracts;
- persistent tasks, approvals, attempts, costs, events, traces, and monitor
  records;
- exact single-use approval and provider-receipt paths;
- `gpt-5.6-terra` as the current live-worker default with an AUD estimate;
- a supplied-evidence Demand Validator pilot history, with the active streak
  reset to zero;
- guarded web-search, image-generation, and visual-review definitions that stay
  off in protected operation.

Not implemented or not yet proved by this decision:

- a complete Luna/Terra/Sol policy router and current pricing for every route;
- acceptance of a new active supplied-evidence Demand Validator run;
- a live search-enabled Demand Validator Agents SDK proof;
- operational proof for supervised Product Builder and Quality Reviewer work;
- all monitoring checks required by the Phase 1 contract;
- a final retention and privacy schedule;
- dynamic workers or remote/mobile operation.

## Review Trigger

Review this decision after the first complete production-intent journey, or
before any proposal to:

- add or remove a worker;
- let a worker create another worker or choose unapproved tools;
- promote Product Builder or Quality Reviewer beyond supervision;
- expose Jarvis remotely or allow mobile approvals;
- store business/personal trace content with a provider;
- automate publishing, customer contact, account action, spending, legal work,
  disputes, refunds, or money movement.
