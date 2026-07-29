# Architecture Notes

This folder indexes the current architecture records for Pantheon.

Use this folder for current system design, component boundaries, data flow,
integration contracts, deployment notes, and runtime diagrams.

## Current Steering

- `docs/Pantheon Master Plan.md`: business and system source of truth.
- `docs/plans/PANTHEON-COMMERCIAL-TRUTH-AND-OWNER-ABSENT-KIT-READINESS-2026-07-29.md`:
  completed canonical-release, truth-reconciliation, attributable-evidence,
  owner-journey, and next-kit readiness directive.
- `docs/decisions/0009-owner-absent-low-touch-digital-kit-reentry.md`: current
  owner-absent, truthful brand-operated, A$0 preparation, dual-evidence, and new
  low-touch-kit decision.
- `docs/plans/PANTHEON-AGENT-ASSURANCE-AND-OPENAI-INTEGRATION-HARDENING-2026-07-28.md`:
  completed harness versioning, grouped tracing, behavioral evaluation, SDK
  guardrail, and operator-observability directive.
- `docs/architecture/PANTHEON-OPENAI-CAPABILITY-ADOPTION-ROADMAP.md`: future
  OpenAI capability register with commercial adoption triggers and release
  gates.
- `docs/plans/PANTHEON-COMMERCIAL-INTELLIGENCE-FOUNDATION-2026-07-27.md`:
  completed Portfolio, commercial knowledge, investment review, service-trial,
  runtime-control, and release directive.
- `docs/plans/PANTHEON-MULTI-VENTURE-FOUNDATION-AND-VENTURE-KITS-2026-07-22.md`:
  active long-range Venture Factory, kit, isolated-lane, and dynamic-team
  roadmap; its expansion phases remain gated.
- `docs/commercial/COMMERCIAL-CONSTITUTION.md`: shared decision doctrine used by
  Pantheon workers and Jarvis.
- `docs/plans/PANTHEON-COMMERCIAL-OPERATING-SYSTEM-EXECUTION-PLAN-2026-07-18.md`:
  completed earlier commercial and technical foundation.
- `docs/plans/FOUNDATION-TO-FIRST-REVENUE-EXECUTION-PLAN-2026-07-14.md`:
  historical first-proof foundation incorporated into the active plan.
- `docs/plans/AUTONOMOUS-AGENT-OPERATIONS-FOUNDATION-PHASE-1.md`: completed
  Phase 1 worker-operations architecture, gates, receipts, monitoring, routing,
  and implementation boundary; wider autonomy remains gated.

## Current Decisions And Evidence

- `docs/decisions/0004-agents-sdk-first-live-ai-team.md`: Agents SDK is the
  first-class live worker runner inside Pantheon controls.
- `docs/decisions/0005-one-venture-to-first-revenue.md`: commercial scope stays
  on one venture through three independent paying buyers and positive actual
  net cash contribution in AUD; its old Gumroad and owner-work assumptions are
  superseded.
- `docs/decisions/0006-autonomous-agent-operations-foundation.md`: fixed
  11-worker supervised foundation and deferred boundaries.
- `docs/decisions/0007-agent-assurance-before-capability-expansion.md`:
  behavioral assurance must precede broader tools, orchestration, and commerce
  capabilities.
- `docs/decisions/0008-buyer-intent-before-full-catalogue.md`: completed
  buyer-intent attempt, closed by its terminal non-pass branch.
- `docs/decisions/0009-owner-absent-low-touch-digital-kit-reentry.md`: current
  commercial preparation and operating-policy decision.
- `docs/proofs/2026-07-29-buyer-intent-terminal-quality-proof.md`: exact stopped
  build, unchanged package, terminal result, browser, recovery, and release
  evidence.
- `docs/proofs/2026-07-29-pantheon-commercial-truth-schema-26-release-proof.md`:
  canonical schema-26 source, migration, recovery, owner-browser, private-CI,
  merge, and no-external-action evidence.
- `docs/reviews/OPENAI-AGENTS-SDK-ARCHITECTURE-REVIEW-2026-07-16.md`: historical
  implementation review and guarded-tool boundary.
- `docs/reviews/PRE-FIRST-USE-ENGINEERING-AND-SECURITY-REVIEW-2026-07-17.md`:
  historical first-use release evidence and residual risks.
- `docs/proofs/2026-07-27-commercial-intelligence-foundation-proof.md`:
  completed live Portfolio and foundation release evidence.

## Current Commercial Truth Path

The released schema-26 baseline implements one canonical path for a future
commercial test:

`v2 contract → proposed → owner-accepted → owner-activated → contract-bound work → immutable receipts and evidence → deterministic evaluation → read-only Tests & Results`

In owner terms, Pantheon may now describe a test as current only when one exact
commercial decision has been accepted and activated. It may describe buyers,
revenue, refunds, costs, or net cash contribution only when the canonical
evidence ledger supports those claims. A stopped or closed test remains visible
as history without looking actionable.

The path is deliberately exact:

- The v2 contract binds one venture, Venture Kit version and hash, offer version
  and content hash, buyer and problem, experiment, cohort, reporting period,
  price, channel, provider account, adapter version, attribution window,
  evidence rules, decision rules, and protected actions.
- Acceptance and activation are separate, single-use owner decisions. A paused
  test requires fresh acceptance and then fresh activation; a terminal stop or
  close takes precedence and cannot be reopened.
- New work, approvals, tasks, costs, adapter claims, and execution records must
  preserve the same decision binding. An unknown or substituted adapter fails
  closed.
- Imported platform evidence and operator-attested manual evidence retain
  different provenance. Source and row hashes, immutable receipts,
  provider/account transaction keys, and contract-bound HMAC buyer pseudonyms
  support deduplication without storing raw buyer contact details in the
  commercial record.
- Corrections, refunds, and reversals are append-only. A verified closed
  evidence-set manifest and deterministic evaluation hash make the result
  reproducible.
- Only cash-settled revenue contributes to proof. Unknown, estimated, or merely
  incurred costs block proof until every attributable cash cost is reconciled.
  Platform balance is not bank-settled cash.
- The proof rule remains at least three independent paying buyers and positive
  actual net cash contribution in AUD after refunds and all attributable cash
  costs.

The owner summary, Command Center, weekly digest, monitor, commercial
authority, and Tests & Results projection use this same canonical record. Older
commercial experiment, result, plan, and journey tables remain read-only
historical context; they are not authoritative v2 buyer or cash evidence.
Retired legacy creation and execution routes return `410` or otherwise fail
closed rather than manufacturing a new record outside this path.

This is release-proved infrastructure, not commercial proof. There is currently
no accepted-and-activated program for the new kit, no authorised build or
external test, no live Etsy or Gumroad adapter, and no real imported or manual
buyer transaction. Runtime implementation checkpoint `d039d8b` passed the real
signed owner-browser gate locally. Documentation-only release head `cc14ae6`
preserved that runtime implementation, passed all eight pull-request jobs in run
`30451251704`, and merged to private GitHub `main` as `abf6f0d`. The immediate
`main` run `30452100846` independently passed all eight jobs.

## Historical Reference

The superseded 2026-07-04 runtime architecture is retained at
`archive/historical/docs/pre-first-use-2026-07-17/plans/CODEX-RUNTIME-ARCHITECTURE-2026-07-04.md`.
It is reference material only, not an active instruction source.
