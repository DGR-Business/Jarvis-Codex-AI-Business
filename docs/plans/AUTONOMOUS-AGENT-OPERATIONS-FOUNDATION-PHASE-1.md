# Autonomous Agent Operations Foundation - Phase 1

Date: 2026-07-17
Status: active implementation contract; gates are not yet all satisfied
Owner: Daniel
Maintainer: Codex

## Purpose

This phase turns Jarvis's visible AI Team into a supervised operating system for
real business work. It fixes the first worker roster, the order in which live
capabilities may be proved, the records every run must leave, and the conditions
that stop work or return it to Daniel.

This is an implementation contract, not evidence that the whole phase already
runs. The current runtime has useful parts of the foundation, listed under
`Current Implementation Boundary`. Each remaining gate needs code, tests, and
operator proof before its status can change.

This plan sits under `docs/Jarvis-Codex Master Plan.md` and alongside
`docs/plans/FOUNDATION-TO-FIRST-REVENUE-EXECUTION-PLAN-2026-07-14.md`. It does
not replace the one-venture commercial plan or loosen any approval, spend,
publishing, account, legal, or money-movement rule.

## Phase 1 Outcome

Phase 1 is complete only when Jarvis can repeatedly assign bounded work to the
fixed 11-worker team, show what happened, preserve a usable receipt and audit
trail, detect stalled or unsafe work, and return one clear decision or next
money move to Daniel.

Completion does not mean unsupervised business operation. It means the
supervised foundation is reliable enough to use for the first revenue loop.

## Scope

Phase 1 includes:

- one fixed roster of 11 named business workers;
- persisted assignments, handoffs, approvals, attempts, results, and costs;
- supplied-evidence work before any new live research;
- one separately approved and capped Demand Validator live-web proof;
- a receipt, audit, and monitoring contract for protected and live work;
- documented Luna, Terra, and Sol routing intent, without claiming a router
  that does not yet exist;
- supervised Product Builder and Quality Reviewer work;
- one operator view of material decisions, unknown outcomes, failures, and
  budget exposure;
- a retention and privacy decision before sensitive or ongoing operations
  widen.

## Non-Goals

Phase 1 does not include:

- a worker creating, deleting, renaming, or rewriting another worker;
- a changing roster, generated roles, recursive delegation, or open-ended
  worker swarms;
- eleven simultaneous provider calls merely because eleven workers are listed;
- unattended publishing, customer contact, account changes, spending, legal or
  compliance decisions, disputes, refunds, or money movement;
- broad browser, filesystem, shell, email, marketplace, or MCP access for
  business workers;
- autonomous critique-and-retry loops without a fixed attempt cap;
- long-term model memory or SDK sessions as a substitute for Jarvis state;
- remote or mobile control of the local runtime;
- public network exposure of the dashboard;
- a second venture or a second real-world test;
- automatic promotion of any capability from this documentation change.

## Fixed Phase 1 Team

The Phase 1 roster is exactly these 11 workers. The roster is a business
registry, not a promise that every worker has a live provider path or that all
workers run at once.

| Worker | Phase 1 responsibility | Phase 1 operating boundary |
| --- | --- | --- |
| Chief of Staff | Choose the next bounded assignment and compress specialist work into one operator recommendation. | Supervised coordinator; cannot approve its own work or widen a worker's tools. |
| Opportunity Scout | Rank candidate problems and evidence gaps from supplied material. | Supplied evidence and protected work only. |
| Demand Validator | Judge demand evidence, counterevidence, assumptions, and the smallest useful test. | Supplied evidence first; live web only through the separate gate below. |
| Offer Architect | Turn accepted evidence into a buyer, problem, offer, price, and testable promise. | Internal drafting; Daniel decides material positioning and price changes. |
| Product Builder | Prepare the smallest useful product and local asset plan. | Supervised; no publishing, and paid generation needs its own exact approval. |
| Copy and Conversion Agent | Draft claims, listing copy, calls to action, and message variants. | Internal drafting; no sending or publishing. |
| Distribution Agent | Prepare a channel plan, run sheet, tracking plan, and stop rule. | Planning only; no posting, outreach, or account action. |
| Finance and Unit Economics Agent | Check price, cost, contribution, break-even, and exposure. | Read and recommend; cannot move money or write external accounts. |
| Customer Voice Agent | Summarise supplied buyer language, objections, and feedback. | Supplied records only; cannot contact a customer. |
| Growth Analyst | Compare expected and actual results and recommend the next experiment. | Read recorded results; cannot start a new test or spend. |
| Quality Reviewer | Check exact outputs, assets, claims, evidence, and risks before an operator decision. | Supervised and read-only over approved inputs; cannot generate, alter, publish, or approve the asset. |

Adding a twelfth worker, removing one of these workers, changing a role's
authority, or allowing runtime-created roles requires a later decision record
and a new release gate.

## Operating Modes

Every assignment has one plain status:

- **Protected:** local work only. No paid provider or external action occurred.
- **Supervised live:** one exact provider or read-only tool action may occur
  after a current, single-use approval and readiness check.
- **Waiting for Daniel:** the work cannot continue without a decision, changed
  scope, or hard-stop action.
- **Locked:** no implemented and approved path exists. The task must not run.
- **Unknown outcome:** a request may have reached a provider, but Jarvis cannot
  prove the result. It is reviewed before any retry.

No screen may use `autonomous`, `live`, `complete`, or `successful` when the
stored run state and receipt do not support that wording.

## Assignment And Handoff Contract

Before a worker starts, Jarvis must have a persisted work packet containing:

- venture, workflow, task, worker, and capability identifiers;
- the business question and expected operator-facing output;
- buyer, problem, offer, channel, price or margin assumption, and evidence
  standard where the work is commercial;
- supplied evidence with provenance, version, and a stable fingerprint;
- allowed tools and exact tool limits;
- requested model route, turn limit, deadline, output schema, and cost cap;
- success measure, stop or revise rule, and required reviewer;
- approval identifier and scope hash when approval is required;
- trace, provider-storage, and data-class settings.

A handoff creates a new bounded assignment. It does not silently pass the
previous worker's tools, approval, budget, or authority to the next worker. The
Chief of Staff may recommend the next assignment, but Jarvis remains the owner
of queue state, limits, and approvals.

## Demand Validator Proof Order

### 1. Supplied-Evidence Proof

Demand Validator first works from one versioned evidence packet supplied by the
runtime or Daniel.

The proof must:

- use no web, browser, connector, or other external tool;
- use one turn and no SDK handoff;
- stay within 1,200 output tokens and an approved A$1 maximum cost;
- identify evidence, counterevidence, assumptions, a price/channel hypothesis,
  the smallest test, metric, stop rule, confidence, and risks;
- receive a technical review and Daniel's separate commercial-usefulness
  verdict;
- leave a complete local receipt and audit sequence.

A historical pilot is useful evidence, but the active runtime was deliberately
reset to a zero capability streak. A new active run must earn its own review.

### 2. Separately Approved Live-Web Proof

Only after the supplied-evidence result is accepted may Jarvis prepare a live
web request. The supplied-evidence approval does not carry over.

The live-web proof requires:

- a fresh, single-use approval naming the question, worker, model, search tool,
  limits, deadline, evidence standard, storage policy, and maximum cost;
- a maximum A$2 approved cost, three search calls, and 120 seconds;
- public, read-only research with no login, form submission, download,
  publishing, account action, or customer contact;
- recorded queries, sources, access times, claim-to-source links, and
  counterevidence;
- a durable provider receipt and an `unknown outcome` state if dispatch cannot
  be proved either complete or not started;
- technical, source-quality, cost, and commercial-usefulness review before the
  result can guide a market test.

This is a separate capability. It starts its own five-consecutive-reviewed-run
record and cannot inherit promotion from supplied-evidence reasoning.

## Product Builder And Quality Reviewer

Product Builder and Quality Reviewer remain supervised throughout Phase 1,
even if other internal drafting capabilities later earn promotion.

Product Builder may:

- prepare local product files, specifications, and an asset plan from an
  accepted offer and supplied evidence;
- request one exactly described paid asset-generation action with its own
  prompt, size, quality, storage, output, and cost approval;
- return the work to Daniel when quality, IP, evidence, or channel requirements
  are unclear.

Product Builder may not publish, upload, contact a buyer, change an account, or
approve its own output.

Quality Reviewer may:

- inspect only the exact local deliverable or asset identifiers approved for
  the review;
- report quality, unsupported claims, missing evidence, IP/platform concerns,
  and a recommendation;
- reject the work or ask for revision without triggering a new provider action.

Quality Reviewer may not generate or alter assets, decide legal compliance,
publish, or turn its recommendation into approval. Daniel remains the final
reviewer for consequential use.

## Luna, Terra, And Sol Routing Intent

Model selection is per assignment, not a permanent rank attached to a worker.
The same worker may need a different route when ambiguity, evidence volume, or
consequence changes.

| Route | Intended use | Phase 1 status |
| --- | --- | --- |
| Luna | Clear, repeatable, low-ambiguity work such as structured extraction, format checks, deduplication, and first-pass summaries over supplied material. | Implemented as `gpt-5.6-luna` with current registered safety pricing. |
| Terra | Everyday commercial analysis, bounded specialist drafting, and normal evidence review where cost and speed matter. | Implemented as `gpt-5.6-terra` and used for normal business work. |
| Sol | Ambiguous, high-consequence synthesis, difficult exception review, architecture, and root-cause work where deeper judgement is worth the extra time and cost. | Implemented as `gpt-5.6-sol` for deep research, consequential judgement, and quality escalation. |

Routing rules:

- choose the lowest route that can safely do the exact job;
- never let model choice grant a tool, approval, budget, or external authority;
- bind the requested and selected model to the execution descriptor and any
  live approval;
- record the selected model and reason in the receipt;
- do not silently fall back to a different route after approval;
- block live dispatch when price, availability, or the approved model cannot be
  verified;
- treat `.codex/config.toml` as Codex engineering configuration, not the Jarvis
  business-worker model router.

The route policy, current pricing records, approval binding, no-fallback rule,
tests, receipt fields, and operator-visible explanation were implemented and
proved on 2026-07-17. An explicit model override is still allowed only before
the exact approval is created.

## Receipt Contract

A receipt is the durable account of what Jarvis attempted and observed. It is
not automatically a provider invoice and must not turn an estimate into actual
spend.

Every attempt records, as applicable:

- run and attempt IDs plus venture, workflow, task, worker, and capability;
- assignment version and input fingerprint;
- requested and selected provider/model;
- tool allowlist, actual tool calls, arguments, limits, sources, and asset IDs;
- approval ID, scope hash, decision time, expiry, and consumption time;
- start, dispatch, provider-response, local-processing, and finish times;
- provider request, response, and trace IDs when returned;
- input/output token usage, hosted-tool usage, and cost state;
- output schema result and stable output or asset hash;
- trace and provider-storage policy without private chain-of-thought;
- final outcome, error, interruption, retry relationship, and review status.

Protected work records a local no-provider receipt. If a live call is attempted,
Jarvis records the provider receipt as soon as it has enough evidence to do so,
before later local processing can hide that the call occurred. Missing provider
identifiers do not prove that no call occurred.

## Audit Contract

- Approvals, attempts, receipts, events, costs, evaluations, and operator
  decisions remain linked by stable IDs.
- Scope changes create a new assignment and approval; they do not rewrite the
  old record.
- Reconciled accounting is corrected by reversal or revision, not deletion.
- A failed or ambiguous call remains visible. A retry is a new attempt with a
  new approval when live cost or effect is possible.
- Evidence records preserve provenance and clearly separate supplied material,
  fixtures, public sources, platform imports, and receipts.
- Operator summaries may be concise, but the underlying structured record must
  remain inspectable.
- Secrets, raw credentials, private chain-of-thought, and unnecessary personal
  data are never audit requirements.

## Monitoring Contract

The Phase 1 monitor must detect and deduplicate at least:

- stalled queue items, expired leases, missed scheduler heartbeats, and repeated
  failures;
- live attempts without the expected receipt or audit links;
- approval replay, expiry, scope mismatch, or work that continued after denial;
- unknown outcomes awaiting review and unsafe automatic retry attempts;
- unreconciled reservations, unknown cost, and monthly-cap exposure;
- missing source provenance, failed evaluations, and rejected quality checks;
- provider or tool readiness drift;
- backup, restore, retention, or deletion failures once the retention schedule
  is approved.

The monitor reports the affected work, evidence, risk, and next operator action
in ordinary wording. It may pause or escalate work under an existing safety
rule. It does not approve spend, retry an unknown provider outcome, or widen a
worker's authority.

The scheduler-backed monitor now checks terminal attempts for receipts,
incomplete or review-required receipt state, stale live runs, unknown outcomes,
and receipt-chain integrity. Focused tests and the live System Checks view
passed on 2026-07-17.

## Retention And Privacy Decision

Before ongoing live-web work, provider-side storage for business evidence, or
any customer-data worker is enabled, Daniel must approve a written retention
schedule covering:

- how long assignments, model inputs/outputs, receipts, traces, sources,
  evaluations, and generated assets remain local;
- whether any provider response or trace content may be stored, for which data
  classes, and for how long;
- how source snapshots and removed web content are handled;
- how rejected or superseded generated assets are deleted;
- which approval, accounting, security, and audit records must be retained;
- how backups honour deletion and legal retention requirements;
- how buyer identifiers, feedback, and other personal data are minimised,
  hashed, redacted, exported, or deleted.

Until that decision is recorded:

- provider response storage and trace content stay off for business or personal
  data;
- an exact approval may enable them only for a controlled, non-personal fixture;
- live worker packets exclude raw buyer names, email addresses, credentials,
  browser profiles, and unnecessary personal text;
- Jarvis retains the existing local audit and backup records rather than
  silently deleting evidence;
- no new long-term model memory, remote/mobile access, or customer-data agent
  operation is introduced.

This is a required operator decision, not a detail for a worker to infer.

## Gates And Current Status

| Gate | Evidence required | Status on 2026-07-17 |
| --- | --- | --- |
| 0. Operating contract | Active plan, accepted decision record, current pointers, and fixed roster. | Passed on 2026-07-17. |
| 1. Bounded worker operations | Persisted work packets, handoffs, exact approvals, attempt states, receipts, audit links, and focused monitoring tests. | Passed on 2026-07-17: schema 12, immutable receipt/provenance chains, provider-dispatch safety, model routing, focused monitor checks, 123 tests, doctor, backup restore, and real-browser proof. |
| 2. Demand Validator supplied evidence | One active no-tool run within cap, complete receipt, technical pass, and Daniel usefulness verdict. | Exact run prepared on 2026-07-17 and waiting for Daniel's approval. It uses Sol, one turn, 1,200 output tokens, no tools/effects, an A$0.10 priced upper bound, and an A$1 hard cap. No provider call has occurred. |
| 3. Demand Validator live web | Separate approved A$2/three-search/120-second run with grounded sources, receipt, cost review, and no external side effect. | Tool bridge and controls are present; live search-enabled SDK proof is not recorded as complete. |
| 4. Supervised build and review | Product Builder produces one bounded local product/asset result and Quality Reviewer inspects exact approved inputs, both with receipts and Daniel review. | Contracts and guarded tool definitions exist; active live proof is pending. |
| 5. Retention and privacy | Daniel approves the data classes, storage locations, durations, deletion rules, and provider-storage policy. | Decision required. |
| 6. Phase 1 release | Complete tests, health check, monitor cycle, one safe queued proof, event-timeline update, recovery check, and ordinary-language operator review. | Pending. |

No later gate can waive an earlier one. A failed gate returns the exact
capability to supervised or locked status; it does not lower the evidence bar.

## Deferred Work

### Remote And Mobile Operation

Remote dashboard access, mobile approvals, push notifications, public tunnels,
and control from another device are deferred. A later design must cover strong
operator authentication, device loss, session expiry, CSRF/origin rules, audit,
network exposure, emergency shutdown, and recovery before the localhost-only
boundary changes.

Responsive local browser layouts do not count as remote/mobile operation.

### Dynamic Agents

Runtime-created workers, generated instructions, self-selected tools, recursive
worker creation, and an open worker marketplace are deferred. A later phase must
prove why a fixed role cannot do the work, how new roles are reviewed and
versioned, how authority is bounded, and how cost and context growth are capped.

## Phase 1 Exit Rule

Phase 1 may be marked complete only after all seven gates have dated evidence in
`docs/Jarvis-Codex Build Log.md`. Until then, the honest status is `active,
supervised, and incomplete`.
