# Pantheon Developer Audit

Date: 2026-07-28
Status: local stabilization verified; CI and supervisor release pending
Scope: runtime lifecycle, tests, AI authorization, cost truth, workflow
continuation, proof records, files, shutdown, monitoring, dashboard claims, and
current release readiness

## Executive Verdict

Pantheon's deterministic business kernel remains worth continuing. Its state,
approvals, attempts, provider records, cost ledger, artifacts, evaluations, and
commercial workflow are materially real rather than a dashboard simulation.

Pantheon is not yet ready for Daniel's unattended first-use test. The audit
found one critical developer-operations defect and one critical authorization
defect:

1. a local Windows lifecycle test could leave a descendant process alive after
   the test deadline, causing Codex to wait for tens of minutes with no useful
   progress; and
2. a paid Quality Reviewer call ran under the internal mandate even though its
   exact decision packet said Daniel's approval was required.

Neither defect caused publication, customer contact, account action, money
movement, advertising, or another external effect. Both invalidate a claim
that the current buyer-intent run or local launcher is clean proof.

## Incident 1: Long-Running PowerShell Command

### What happened

The dangerous command was:

`npm.cmd test -- test/windows-launcher.test.js`

The effective process tree was:

`npm -> run-tests.js -> node:test -> PowerShell launcher -> fake Node server -> child Node`

The Node test deadline covered the direct test process but did not reliably own
or terminate every Windows descendant. One watchdog also invoked synchronous
`taskkill` without its own deadline. A timed-out test could therefore stop
producing output while a descendant kept a handle or port alive.

PowerShell was not the sole cause. The engineering fault was nested process
ownership plus unbounded waiting.

### Immediate correction

- `windows-launcher.test.js` is excluded from ordinary and local test runs.
- An explicit local request fails fast with a clear quarantine error.
- The lifecycle test runs only when both `CI=true` and
  `PANTHEON_LIFECYCLE_CI=1`.
- Its Windows CI job has an external eight-minute ceiling.
- Ordinary local tests have a four-minute wrapper ceiling.
- Reviewed renderer, archive, Doctor, backup, launcher-control, and shutdown
  subprocesses now have explicit deadlines and bounded output.
- Timeout cleanup uses a separately bounded process-tree termination attempt.

### Remaining release blocker

Quarantine prevents another local development hang; it does not make the
launcher architecture ideal. The correct permanent design is one lightweight
Node supervisor using a Windows Job Object with kill-on-close semantics.
Pantheon-owned state should live outside the repository, lifecycle transitions
should be atomic, and setup must remain separate from start. Ten repeated
cycles must leave no owned process or listening port.

## Incident 2: Human Approval Was Bypassed

Pantheon executed this task:

`task_live_worker_wf_buyer_intent_social_media_manager_client_control_v1_catalogue_quality_catalogue_validation_social_media_manager_2d9a65f51395`

Recorded facts:

- worker: Quality Reviewer;
- model: `gpt-5.6-terra`;
- provider response:
  `resp_0f0d5d8bd90501c4016a683f02711081988189be305173df9b`;
- trace: `trace_1476c7cf57044123a466f76bf2734d6a`;
- outcome: known and completed;
- evaluation: passed structurally at 100;
- product quality score: 88;
- business verdict: `revise`;
- estimated cost: A$0.16, billing pending; and
- external effects: none.

The task's own reason said a final review required Daniel's exact approval.
Policy nevertheless allowed the monthly internal mandate because the path
checked a newer manual-approval field but not the legacy
`operatorChoiceRequired` field present on this record.

Both flags now force a manual decision. Explicit human-decision intent outranks
an internal mandate.

## Buyer-Intent Cost And Proof Truth

The workflow has five incurred worker estimates:

| Work | Estimated AUD |
| --- | ---: |
| Product Builder | A$0.03 |
| Quality review 1 | A$0.14 |
| Quality review 2 | A$0.14 |
| Quality review 3 | A$0.16 |
| Quality review 4 | A$0.16 |
| **Total** | **A$0.63** |

All exact billing remains pending. No amount is presented as reconciled usage.
The product still needs two buyer-facing copy corrections. The workflow is
`needs_attention`, not quality-passed, buyer-validated, ready to publish, or
commercially proven.

The runtime now permits at most one measured correction. The retired fourth
review path always fails. Budget enforcement uses the greater of each task's
incurred or unresolved reserved exposure, avoiding both double-counting and the
old mistake of adding every historical maximum cap forever.

## Other Material Findings And Corrections

### Shutdown and scheduler

- New scheduler ticks stop immediately when shutdown begins.
- Normal shutdown waits for the active tick to drain before closing the server
  and database.
- Provider timeouts remain unknown outcomes and are not automatically retried.
- Emergency termination remains recovery-backed and is not equivalent to a
  graceful drain.

### Proof integrity

- A model-backed proof requires a completed agent run, exact model-call binding,
  live mode, known terminal outcome, provider request ID, completion timestamp,
  and passing evaluation.
- Schema migration 24 backfills completion only when linked task, attempt, or
  agent-run evidence exists.
- Deterministic Distribution and Chief steps are marked
  `deterministic_system_step` and shown as “System-generated step,” not as
  model-backed agent work.

### File integrity

- Customer deliverables are persisted individually as well as in the archive.
- Downloads require an allowlisted type, recorded content hash, canonical path
  inside an approved root, and a 150 MB maximum.
- Tampered content fails with HTTP 409.
- Archive validation rejects path traversal, executable content, excessive
  entries, excessive expanded size, and invalid Office package structure.
- Formula-leading untrusted text is escaped before spreadsheet rendering.
- Quality review binds to exact manifests, hashes, files, and rendered previews.

### Workflow and dashboard truth

- Pre-venture Business Tests are visible even when no active venture exists.
- A quality revision is shown as “needs attention,” not “still preparing.”
- Provider evidence gaps, non-calls, unknown outcomes, model-backed runs, and
  deterministic steps have distinct user-facing labels.
- Monitoring findings use structured fingerprints to prevent repeated noise.

## Architecture Debt

These are not reasons to discard Pantheon, but they should not be ignored:

- Windows lifecycle ownership is split across PowerShell and Node.
- `pantheon-production.js`, `cockpit-state.js`, and `public/app.js` are
  oversized and expensive to reason about.
- Buyer-intent state is projected into several compatibility records.
- Historical final-review UI remains for old records even though the runtime
  cannot create a new override.
- Deterministic system steps still use the `agent_runs` table for compatibility.
- Runtime lifecycle metadata still lives under the repository rather than a
  dedicated per-user application-data root.

Refactoring should follow the supervisor release and one proven commercial
loop. Broad rewrites before those gates would add risk without improving
revenue evidence.

## Verification Completed

- all 144 JavaScript files parsed;
- Python renderer AST parsed;
- five changed PowerShell files parsed without execution;
- lint passed with zero warnings;
- `git diff --check` passed;
- changed-code secret scan found no credential pattern;
- the quarantined local launcher command refused in 1.6 seconds;
- buyer-intent validation: 2 tests passed;
- live-worker proof hardening: 12 tests passed;
- production runtime: 23 tests passed;
- foundation: 38 tests passed;
- runtime: 83 tests passed;
- backup Doctor: 6 tests passed;
- recovery set: 4 tests passed; and
- the complete ordinary isolated suite passed 296 of 296 tests in 129 seconds,
  excluding the quarantined Windows lifecycle integration.

The installed dependency tree validated locally. The registry-backed
`npm audit` request was blocked by the development sandbox's external-egress
policy; private GitHub CI retains the critical-severity audit gate.

Doctor passed Node, lockfile, SQLite, pricing freshness, archive tooling, PDF
and workbook rendering, writable data and artifact roots, database integrity,
backup encryption, encrypted OneDrive destination, and recovery-set
verification. Its only warning was the expected occupied dashboard port.

No live server, browser, launcher lifecycle, or paid provider call was started
by this audit. A pre-existing Pantheon Working instance remains at port 5051
under ownership metadata for PID 30060. It is responsive, uses approximately
108 MB of working memory, has no queued or running task, and reports only the
two retained quality-review warnings documented above. The audit did not stop
or restart it.

## Release Decision

Current decision: **hold unattended operator testing**.

Release requires:

1. the full ordinary isolated suite, excluding lifecycle integration, passes
   under its external deadline;
2. private GitHub ordinary and dedicated lifecycle CI pass;
3. the supervisor and Job Object release proves ten clean lifecycle cycles; and
4. Daniel explicitly authorizes any further paid buyer-intent correction.

The safe next move is stabilization and CI, then the supervisor release. Do not
resume product work merely to make the dashboard look complete.

## Post-Audit Supervisor Result

The recommended supervisor was implemented and passed its local release gate
on 2026-07-28.

- A source-built native Windows supervisor now owns the standby and working
  tree through a kill-on-close Job Object.
- Ten complete lifecycle cycles released both ports, every exact ownership
  record, and every owned child.
- Forced supervisor termination removed its standby and working descendants.
- An unrelated Node process remained untouched.
- The lifecycle suite passed 9 of 9 in 237.9 seconds after the same ten cycles
  were divided across two sequential isolated five-cycle cases.
- The ordinary suite passed 297 of 297 in 124.0 seconds.

Private `Pantheon checks #16` passed its pre-supervisor Windows lifecycle job.
Its ordinary job printed all 296 test passes but reached the old 12-minute
single-process deadline before final exit. Ordinary CI is now divided into
four isolated shards while retaining explicit per-job deadlines. Operations
readiness remains held until the revised supervisor commit passes private CI.

Subsequent clean CI runs found two more masked assumptions: a missing
`pypdfium2` runtime dependency and an isolated test that inherited the
operator's AUD/USD setting. The renderer is now pinned, the test environment
uses a deterministic conservative conversion, and the attempted concurrent
lifecycle lanes were replaced after they caused full-runtime startup
contention on the hosted runner. These are examples of CI improving the release,
not reasons to relax the gates.

Exact evidence is retained at
`docs/proofs/2026-07-28-windows-supervisor-local-proof.md`.
