# Jarvis-Codex Build Log

Last updated: 2026-07-17
Status: active concise record

The detailed pre-first-use development history is preserved at
`archive/historical/docs/pre-first-use-2026-07-17/Jarvis-Codex Build Log pre-first-use.md`.
This file records only current decisions, verified proof, and the next useful
commercial move.

## Current Position

- Product direction: one digital-product venture to first revenue.
- Checkout direction: Gumroad Direct; private KYC is permitted; public identity
  remains faceless and voiceless.
- Runtime: Node.js 24, CommonJS, built-in SQLite, local signed operator session.
- AI execution: OpenAI Agents SDK first, with lower-level Responses paths where
  direct control is useful.
- External actions: locked by default.
- Operator budget: eight hours per week in the build and first-proof phase.
- Pre-revenue AI and tool cap: A$100 per month.

## Durable Decisions

| Date | Decision | Reason |
| --- | --- | --- |
| 2026-07-04 | The Master Plan is the active source of truth. | Chat history must not be the architecture. |
| 2026-07-04 | Claude-era material is historical only. | Active behavior belongs in the Codex runtime. |
| 2026-07-05 | Digital products precede POD. | The first loop should be fast, low-cost, and measurable. |
| 2026-07-09 | Agents SDK is the first-class live AI Team path. | Specialist loops, tools, handoffs, tracing, and interruptions fit the destination. |
| 2026-07-14 | Prove one venture before expansion. | Results and simplicity outrank capability theatre. |
| 2026-07-17 | Reset the active cockpit to a production-ready clean slate. | Pilot evidence remains recoverable but must not compete with real business work. |
| 2026-07-17 | Keep provider reasoning review structured and truthful. | Live Runs records evidence, conclusions, tools, sources, traces, cost, and evals without claiming private chain-of-thought. |
| 2026-07-17 | Store the standalone OpenAI credential with Windows-user-bound encryption. | Explorer startup must work without storing a plaintext key or weakening per-run approvals. |
| 2026-07-17 | Use a fixed, supervised 11-worker Autonomous Agent Operations Phase 1. | Bounded assignments, receipts, monitoring, and staged capability proof must precede wider autonomy. |

## 2026-07-17 Foundation Hardening

Implemented:

- focused cockpit, decision, test, AI Team, Live Runs, and system APIs;
- retirement of the giant legacy state route and unsigned approval links;
- signed HttpOnly local sessions, CSRF, Host, Origin, and WebSocket validation;
- static and PDF path containment, security headers, request limits, and server
  timeouts;
- atomic task leases, stale-work recovery, and provider-safe scheduler rules;
- immutable execution descriptors and exact single-use approval scopes;
- truthful reserved, estimated, unknown, reconciled, and released cost states;
- structured provider receipts, grounded source provenance, visual byte binding,
  and tool-approval replay protection;
- versioned schema migration and an atomic first-use reset that preserves
  reconciled accounting and provider costs;
- encrypted source, database, and artifact backup with authenticated restore;
- one-click Windows start and stop launchers plus an encrypted standalone OpenAI
  connection;
- a compact Live Runs surface for genuine provider activity and protected
  rehearsals, without chain-of-thought claims;
- a conservative archive for superseded plans and pilot reviews.

## 2026-07-17 Autonomous Agent Operations Foundation

Documentation decision:

- Phase 1 keeps the current 11-worker business roster fixed. Runtime-created
  workers and recursive delegation are deferred.
- Demand Validator must complete an active supplied-evidence proof before Daniel
  can separately approve one A$2, three-search, 120-second live-web proof.
- Product Builder and Quality Reviewer remain supervised and cannot publish or
  approve their own work.
- Every attempt must meet the receipt, linked audit, cost-state, outcome, and
  monitoring contract in the active Phase 1 plan.
- At this documentation-only checkpoint, Luna, Terra, and Sol were routing
  intent only. The implementation proof below records the later completed
  router and supersedes that temporary status.
- Remote/mobile operation and dynamic agents remain deferred.
- Daniel still needs to decide retention periods, provider-side storage,
  deletion, backups, and personal-data handling before sensitive operations
  widen.

Existing runtime evidence supports parts of the contract: all 11 worker
definitions and structured outputs exist; exact approvals, provider receipts,
cost states, events, and a scheduler-backed monitor exist; and the guarded web,
image, and visual-review definitions stay off in protected operation. The active
supplied-evidence run, live-web proof, supervised Product Builder/Quality
Reviewer proof, complete model router, foundation-specific monitor proof, and
retention decision remain pending.

No runtime code or tests were changed by this documentation decision.
Documentation checks found all 11 roster entries, resolved 34 repository-path
references, and passed `git diff --check`. The current Codex manual confirms the
project settings used in `.codex/config.toml`; the packaged Codex CLI could not
be executed from this PowerShell environment, so a CLI parse result was not
counted.

### Implementation proof

The documentation-only status above was superseded later on 2026-07-17:

- schema migration 12 added append-only `agent_run_receipts` and
  `agent_run_provenance`, receipt-chain verification, provider-dispatch
  timestamps, and evaluation version/input hashes;
- live provider research sources now persist with provider provenance, while
  local lifecycle events describe readable stages without exposing or claiming
  private chain-of-thought;
- provider dispatch is recorded immediately before the SDK call and stale
  recovery cannot retry a dispatched attempt automatically;
- model costs link to their exact run, task, attempt, and model call;
- the monitor detects stale runs, missing or incomplete receipts, review-needed
  outcomes, and receipt-chain failures;
- Live Runs, Command Center, and System Checks now show active execution,
  receipt state, ordinary-language progress, and audit integrity;
- Luna (`gpt-5.6-luna`), Terra (`gpt-5.6-terra`), and Sol
  (`gpt-5.6-sol`) routing is implemented with current official pricing checked
  on 2026-07-17. The selected route and reason are approval-bound, visible to
  the operator, stored in the receipt, and cannot silently fall back.

### Task-scoped team and supervised build proof

The Phase 1 runtime foundation was expanded later on 2026-07-17:

- schema migration 13 added immutable venture records and task-scoped worker
  context snapshots. Each live request binds its exact venture, worker, purpose,
  record classes, context hash, and approval; credentials and direct customer
  identifiers remain excluded by default;
- Chief of Staff can prepare exactly one bounded assignment for one existing
  specialist in protected or supervised-live mode. The exact child task now
  records running, quality-check, completed, changes-required, or failed state,
  so a finished assignment cannot block the next valid assignment;
- schema migration 14 added immutable per-deliverable Quality Reviewer records.
  The reviewer sees the exact frozen content or approved local image; any change
  after approval blocks before a provider call;
- quality verdict writes are transactional and idempotent. A dashboard retry
  returns the same immutable result rather than duplicating it;
- Product Builder can prepare one exact `gpt-image-2` request with an A$1 cap,
  one tool call, no external effects, and separate Quality Reviewer approval.
  Returned image signatures are validated, bytes are written atomically to a
  hash-versioned managed path, and PDF/image outputs preview in the dashboard;
- the monitor now detects broken Quality Reviewer chains, missing or invalid
  task context, and orphaned or stopped Chief assignments. Consequential
  findings enter the weekly executive brief without turning normal queued work
  into noise;
- the Windows launcher now loads guarded image generation from the protected
  OpenAI profile. Duplicate legacy launchers were moved to
  `archive/historical/windows-launchers/`; `START JARVIS.cmd` and
  `STOP JARVIS.cmd` remain the only operator shortcuts.

Verification at this checkpoint:

- 136 of 136 tests passed, including the real HTTP preparation and image-preview
  paths;
- Product Builder and Quality Reviewer SDK tests used mocked provider runners,
  so no paid model or image call occurred;
- the active database still contains one pending Demand Validator approval,
  one blocked exact task, and zero post-reset model calls.

Verification:

- fresh encrypted source, database, and artifact backups were created and
  restored into `C:\tmp\jarvis-restore-20260717-151101`; authenticated hashes
  matched, SQLite checks passed, and there were zero foreign-key violations;
- the live runtime migrated from schema 11 to schema 12 with `quick_check=ok`;
- Jarvis doctor passed every check, with only the expected occupied-port warning
  while the owned runtime was running;
- all 123 tests passed;
- real-browser checks passed at 1440x900, 1280x720, and 1024x768 with no Jarvis
  console error or horizontal overflow. One Chrome-extension warning was
  observed and excluded because its URL and message were unrelated to Jarvis;
- System Checks reported a valid empty receipt chain before the first active
  live run.

Three older 2026-07-14 backup files could not be authenticated with the current
backup passphrase. They were left untouched. The new 2026-07-17 rollback set is
independently verified and usable.

### Prepared Demand Validator proof

The first active supplied-evidence proof is prepared and waiting for Daniel's
exact approval:

- question: whether a concise weekly cash-control checklist for solo service
  businesses should advance to a small interest test;
- supplied evidence: two controlled fixture items, with no claim that they are
  live market proof;
- worker/model: Demand Validator using Sol because this is a research judgement;
- limits: one turn, 1,200 output tokens, no tools, no handoffs, no external
  effects;
- cost: A$0.10 current priced upper bound inside an A$1 hard maximum;
- review: deterministic checks first, then Daniel's separate commercial
  usefulness verdict.

The dashboard decision drawer shows the assignment, model reason, limits, costs,
trace policy, and external-action boundary in ordinary language. No paid model
call has occurred.

### Final Phase 1 engineering checkpoint

The bounded-worker foundation received its final pre-live verification on
2026-07-17:

- one readiness-card defect was found and corrected: Product Builder's valid
  `requires_approval` permission had been compared with the wrong internal
  label. The strict approval-controlled tool policy itself was unchanged;
- all 136 tests passed after the correction, including isolated context,
  concurrency, exact approvals, immutable receipts, Chief assignments, frozen
  Quality Reviewer inputs, Product Builder asset handling, monitoring, backup,
  HTTP session, and preview paths;
- Jarvis Doctor passed Node, dependencies, SQLite, archive/PDF tools, writable
  runtime and backup destinations, database integrity, and backup encryption.
  Its only warning was the expected occupied port while Jarvis was running;
- the normal Windows launcher restarted the owned runtime successfully.
  `/api/health` reported a healthy instance, locked external actions, paid AI
  available only behind exact approval, and zero completed or failed
  post-reset provider calls;
- real-browser review passed Command Center, Decisions, Business Tests, AI
  Team, Live Runs, and System Health at 1440x900, 1280x720, and 1024x768. There
  was no horizontal overflow, clipped action, or Jarvis console error. A
  narrow-desktop sidebar label was widened so the full active venture remains
  readable;
- fresh AES-256-GCM source, database, and artifact backups were created in the
  private OneDrive recovery folder and restored independently under
  `C:\tmp\jarvis-restore-20260717-1727`. All authenticated payload hashes
  matched; the database passed quick, integrity, and foreign-key checks; a
  current Product Builder source hash matched byte-for-byte; and the protected
  `private/` area was correctly excluded from the source archive;
- System Health truthfully reports the database, AI worker connection,
  read-only research, and approval-controlled Product Builder visual path as
  connected. External actions remain approval-controlled;
- the cockpit contains one genuine pending item: Daniel's supplied-evidence
  Demand Validator decision. Business Tests and Live Runs remain empty, and no
  historical pilot activity was reintroduced.

No approval was clicked, no provider call was made, and no external business
action occurred during this verification.

## Accounting Preserved At Reset

- ChatGPT Pro active monthly commitment: A$100.00.
- ChatGPT Pro upgrade cash cost: A$94.68.
- OpenAI API credit cash cost: A$15.79.
- Confirmed historical provider usage: A$0.05.

These records remain in the active accounting and cost ledgers after pilot work
is removed. Historical workflows, approvals, packs, model calls, and runs remain
available through encrypted recovery, not the normal cockpit.

## Verification Record

The first-use foundation passed its release proof on 2026-07-17:

- Encrypted source, database, and artifact backups were created in the private
  OneDrive backup destination, authenticated by SHA-256, restored independently,
  and checked byte-for-byte. The restored database passed integrity and
  foreign-key checks.
- The atomic reset manifest
  `48ca93d83fe83f0e79daa3f598c62f9d3309d01435fa8ac6c46b084f6b662e47`
  removed pilot workflows, decisions, packs, calls, runs, tests, messages, and
  business evidence while preserving the exact accounting records above.
- The complete local suite passed 118 of 118 tests. A fresh clone of commit
  `bd07d2c011fb0232efb5e75e6127ba5c0f9228ca` installed from the lockfile,
  passed the same 118 tests, started independently, and produced one venture
  with zero workflows, tasks, approvals, outputs, or agent runs.
- Seventy-five JavaScript files passed syntax checks. The production dependency
  audit reported zero known vulnerabilities.
- The workstation doctor passed Node 24, dependency lock, SQLite, archive, PDF,
  data, artifact, backup, database, and encrypted-backup checks. Its only
  warning was the expected occupied dashboard port while Jarvis was running.
- The one-click launcher stopped and restarted the exact owned process. The real
  runtime reported a healthy database, connected Agents SDK workers, connected
  read-only research, locked external actions, and zero post-reset provider
  calls.
- Focused APIs reported zero Important Work, decisions, reviews, suggestions,
  live tests, queue items, outputs, and Live Runs; all 11 workers were visible
  and on standby.
- Real-browser proof passed at 1440x900, 1280x720, 1024x768, 390x844, and
  320x568 with no console errors, horizontal overflow, or clipped controls.
- The verified baseline was published to the private GitHub repository on
  `main` at commit `bd07d2c`.

No paid OpenAI call or external business action was made during this release
review.

## Next Best Work

Daniel reviews and approves, changes, or declines the prepared supplied-evidence
Demand Validator run. After an approved run, Jarvis must inspect the immutable
receipt, provider identifiers, tokens, cost state, deterministic evaluation, and
structured result before Daniel records usefulness. Only an accepted result may
lead to the separate A$2 read-only live-web decision. Daniel must also approve a
plain-language retention schedule before ongoing live research or sensitive
worker use widens. Do not create a Gumroad account, publish, spend beyond the
exact approval, or contact buyers.
