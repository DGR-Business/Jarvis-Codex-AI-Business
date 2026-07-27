# Pantheon Independent Audit Reconciliation

Date: 2026-07-22
Reviewed report: `docs/reviews/PANTHEON-INDEPENDENT-AUDIT-2026-07-21.md`
Audit snapshot: commit `0b9f3ca`, 2026-07-18 foundation baseline
Imported report SHA-256:
`0cb76f1c9f37e3522d90dfb92af0c546f8cc4c9a03102b8af8df514efe877611`
Current workspace: active Full Journey implementation, reviewed before its
rehearsal and production-intent completion

## Executive Decision

The independent audit is technically strong, candid, and directionally right.
Its most important recommendation is accepted: preserve Pantheon's deterministic
state, approval, money, evidence, and recovery core; stop adding overlapping
frameworks; and complete the first commercial loop.

The report is not a current-state certificate. It audited 201 tests and schema
20 before the active Full Journey work. The current tree has a schema-21 journey
record, a nine-specialist pre-publication path, deterministic product rendering,
one-correction recovery, a dedicated journey view, and 230 automated tests.
The desktop-user launcher and credential proof now passes. The Full Journey
still requires its final browser proof, so the journey additions remain
implementation progress rather than a claimed commercial success.

No redesign or framework replacement is justified. The accepted work is
operational hardening, narrow correctness fixes, truthful documentation, and
then immediate return to the live journey.

## Findings Reconciled

| ID | Decision | Current finding and action |
|---|---|---|
| P-01 | Accepted and closed | The audit's decryption failure was stale, but recovery freshness was a real blocker. On 2026-07-22 Pantheon created a fresh AES-256-GCM set, verified 823 files plus SQLite integrity and foreign keys, completed a staged restore, removed the temporary private copy, and passed the full operations doctor. |
| P-02 | Accepted and fixed | ADR 0006 now carries a dated current-status note. It identifies the historical implementation boundary and points to the active Full Journey plan. |
| P-03 | Accepted and fixed | Non-executable `config/*.md` no longer pose as runtime policy. Current delivery/security guidance moved to `docs/policies/`; the old global guardrails and POD taste memory moved to the historical archive. |
| P-04 | Accepted and fixed | Receipt finalization no longer returns from `finally`. An unexpected execution-path exception cannot be silently replaced by receipt handling. ESLint now rejects unsafe `finally` control flow. |
| P-05 | Accepted and fixed | Blocking a task now merges approval metadata into the prior result instead of erasing it. |
| P-06 | Valid, deferred | `tasks.retries` and `attempt_count` describe different legacy views of retries and attempts. Removing one requires a migration and is not worth destabilising the active journey. Consolidate at the v2/schema-rationalisation gate. |
| P-07 | Accepted narrowly | Capability-failure messages now use the active venture rather than a hardcoded seed ID. Other seed-ID defaults remain intentional compatibility while exactly one venture is active; remove them at the multi-venture gate. |
| P-08 | Valid, deferred | The old fixed planner and niche regexes are not the active Full Journey planner. Freeze and remove them only after the journey proves there is no compatibility dependency. |
| P-09 | Valid naming debt, deferred | Enabled and disabled helpers both test whether a named flag is set; call sites remain correct and tested. Rename them in one compatibility cleanup rather than during live proof work. |
| P-10 | No new action | Pantheon already pins Node to major 24 and the doctor opens, writes, queries, and closes a real `DatabaseSync` database. A speculative database-library migration is not justified without an observed Node break. |
| P-11 | Accepted and improved | Gelato, Xero, email, Slack, and ClickUp can no longer appear operational merely because an environment key exists. They report planned/optional and not implemented until a tested adapter exists. |
| P-12 | Rejected as factually stale | `adm-zip` 0.6.0 is the current release, not an old version awaiting a bump. Pantheon keeps its size, extension, magic-byte, traversal, executable, manifest, and atomic-write checks. Reassess on a real advisory or a newer compatible release. |
| P-13 | Accepted as a later design gate | Single-active-venture and sequential execution are current safety constraints. Before venture two: design venture-scoped lanes, per-venture budgets, attribution backstops, and two-venture isolation tests. Do not weaken the current index piecemeal. |
| P-14 | Accepted and implemented narrowly | A Windows GitHub Actions workflow now runs locked install, correctness lint, all isolated tests, and a runtime dependency audit. ESLint found and removed a duplicate key immediately. JSDoc/checkJs on the safety chain remains post-journey work because a broad type retrofit now would delay the commercial proof. |
| P-15 | Accepted with a stronger mitigation | Pantheon already prevents researched text from gaining tools or authority and records grounded sources. Full Journey candidates now show attributable source domains beside the shortlist. A regex "prompt-injection detector" is rejected as false confidence; provenance, counterevidence, strict schemas, no side-effect tools, and operator-visible sources remain the controls. |
| P-16 | Accepted and fixed | The Windows launchers now record and verify the exact executable, PID, Windows start time, owner SID, instance ID, listener PID, port, and one-time control token. Start is lock-protected; duplicate start, stale metadata, graceful stop, exact tree fallback, production/rehearsal stop, port release, and unrelated-Node protection pass automated native-Windows tests. `STATUS PANTHEON.cmd` gives a plain status check. The desktop-user proof also passes with OpenAI loaded only from the Windows-protected LocalAppData store. Crash restart through a Scheduled Task remains later. |
| P-17 | Accepted, frozen | No sixth capability-proof framework will be added. Consolidation is deferred until the first journey completes because a mid-proof data and route migration has more risk than current benefit. |
| P-18 | Valid, deferred | Large modules reduce reviewability. Split them mechanically when the relevant area is next changed after proof; do not mix structural rewrites into the commercial journey. |
| P-19 | Accepted local tradeoff | Restarting invalidates the local in-memory session. The launcher opens a fresh authenticated session. Persistent sessions are unnecessary until remote or multi-operator use is designed. |
| P-20 | Accepted and fixed | Doctor now reports pricing records older than 30 days. Stale pricing is visible before future paid approvals without blocking unrelated local recovery checks. |
| P-21 | Already resolved | Approval escalation is deduplicated by approval/channel/status. The existing runtime test calls the idle path twice and proves only one outbox record remains. |
| P-22 | Accepted migration residue | `JARVIS_*` compatibility aliases remain one-way and Pantheon-authoritative. Remove them at a named v2 compatibility break, not piecemeal. |
| P-23 | Accepted operating duty | Provider estimates remain distinct from invoices. The active proof exposure ledger and monthly reconciliation remain required; no estimate will be relabelled as settled spend. |

## Additional Findings From Reconciliation

### R-01 - Current Agents SDK transitive advisories

The audit's zero-vulnerability result was correct when it ran but is no longer
current. On 2026-07-22 npm initially reported six moderate advisories and one
high advisory under the Agents SDK's MCP dependency. A compatible lockfile
update moved `fast-uri` to patched version 3.1.4 and removed the high advisory.
Six moderate `@hono/node-server` advisories remain in the transitive MCP server
path. Pantheon does not start an MCP or Hono server and does not use Hono static
serving, but `@openai/agents` currently imports the MCP package at load time, so
removing optional dependencies breaks the SDK.

Decision: keep the pinned, proven SDK dependency; do not force the audit's
breaking downgrade to an old Agents SDK; keep the six moderate advisories
visible in CI; fail CI on critical runtime advisories; review every compatible
Agents SDK patch and remove the exception as soon as the upstream path is fixed.

### R-02 - Full Journey changes the capability verdict

The audit correctly described the 2026-07-18 runtime as a narrow live-AI
aperture. The current implementation now connects Opportunity Scout, three
Demand Validator runs, Finance, Offer, Product, Quality, Copy, Distribution, and
Chief of Staff through persisted independent stages. This is materially closer
to the intended product, but it remains unproven until the real rehearsal and
production-intent runs finish and every generated file is inspected.

### R-03 - Protected contract output remains presentation scaffolding

The audit is right that deterministic worker templates can fill presentation
fields with fallback prose. Live Full Journey workers are separately constrained
by strict structured-output schemas and stage acceptance checks, so this is not
the live acceptance mechanism. Rename and consolidate this protected-mode
scaffolding with the proof-framework rationalisation after the first journey;
do not count it as model quality evidence.

### R-04 - Combined proof exposure and terminal-state recovery

The reconciliation found a safety defect outside the audit's snapshot. The
active journey's carried-plus-local calculation could omit later terminal
journeys and one unbound proof call from the shared A$15 proof cap. A paid stage
could therefore have seen A$0.62 more headroom than truly remained. The budget
reservation path now compares the journey calculation with the verified shared
proof ledger plus every non-terminal journey's local exposure and uses the
higher truth. The current Full Journey exposure is A$11.79, leaving A$3.21.

The same review tightened recovery: a terminal journey cannot be revived by a
normal update. The only exception is an explicit, zero-cost local-file recovery
from `stopped_after_correction`. Refreshed local output versions supersede prior
current deliverables while preserving their immutable history, and the operator
view presents only the latest canonical version of each logical file.

## Accepted Sequence

1. Completed: exact Windows lifecycle behavior, duplicate-start handling,
   stale metadata handling, and unrelated-Node protection pass automated tests.
2. Completed: correctness lint and the complete isolated test suite pass.
3. Remaining desktop proof: start under Daniel's Windows account, then prove
   health readiness and the dashboard lifecycle in Chrome.
4. Resume the isolated Luna rehearsal from its exact persisted stage.
5. Complete and inspect the rehearsal, then run the clean production-intent
   journey inside the same combined A$15 cap.
6. Stop at Ready to publish and report facts, sources, files, corrections,
   costs, and limitations. No external launch action occurs.

## Explicit Non-Actions

- No Temporal, LangGraph, Redis, microservices, vector database, or cloud move.
- No multi-venture schema relaxation before first commercial proof.
- No dynamic agent creation.
- No proof-framework consolidation during the active journey.
- No broad type-conversion or god-module rewrite during the active journey.
- No automatic publication, account action, customer contact, advertising, or
  money movement.
