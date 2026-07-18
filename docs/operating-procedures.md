# Operating Procedures

## Session Start

1. Start Pantheon with `START PANTHEON.cmd` and use the secure dashboard window it
   opens. A manually opened localhost tab is not an authenticated operator
   session.
2. Confirm `/api/health` reports `alive`, `operationsReady`, a running
   scheduler, and a recent completed monitor check. `alive` alone means only
   that the local process is responding.
3. Read `docs/Pantheon Master Plan.md`.
4. Read `docs/Pantheon Build Log.md`.
5. For worker operations, read
   `docs/plans/AUTONOMOUS-AGENT-OPERATIONS-FOUNDATION-PHASE-1.md` and
   `docs/decisions/0006-autonomous-agent-operations-foundation.md`.
6. Check the active task against `AGENTS.md` and `config/guardrails.md`.
7. Check the current venture, queue, approvals, monthly exposure, provider
   readiness, latest monitor result, and unresolved unknown outcomes.
8. Treat `archive/historical/` as context only.

## Worker Operating Modes

Use these words consistently:

- `Protected`: local work only; no paid provider or external action occurred.
- `Supervised live`: one exact paid or read-only provider action may occur after
  a current single-use approval and readiness check.
- `Waiting for Daniel`: an operator decision or hard-stop action is required.
- `Locked`: there is no implemented and approved path.
- `Unknown outcome`: dispatch may have occurred, so retry is blocked pending
  review.

The Phase 1 business roster is fixed at 11 workers. Do not create a dynamic
worker, let a worker create another worker, or treat the Codex subagent thread
limit in `.codex/config.toml` as business-worker authority.

## Before Assigning Work

Confirm that the persisted assignment names:

- the venture, workflow, task, worker, and exact capability;
- the commercial purpose, expected output, measure, and stop or revise rule;
- the evidence packet, provenance, version, and fingerprint;
- the allowed tools, arguments, limits, deadline, turns, model, and cost cap;
- the output schema and required reviewer;
- the trace, provider-storage, and data-class policy;
- the approval ID and current scope hash when approval is required.

If material scope changes, create a new assignment and approval. Do not edit an
old approval into a broader one or pass it through a worker handoff.

## Demand Validator Sequence

1. Prepare one distinct supplied-evidence packet.
2. Run no web, browser, connector, or other external research tool.
3. Keep the proof to one turn, 1,200 output tokens, and an approved A$1 maximum.
4. Record the local receipt, technical checks, and Daniel's usefulness verdict.
5. Only after acceptance, prepare a separate live-web approval naming the exact
   question, model, search limits, deadline, storage policy, and A$2 cap.
6. Limit the live-web proof to three public read-only searches and 120 seconds.
7. Review queries, sources, counterevidence, unsupported claims, receipt, and
   cost before using the result.

Never reuse the supplied-evidence approval for live web. Live web has its own
five-run reviewed capability history.

## Product And Quality Work

- Product Builder may prepare local product work and an asset plan. Paid asset
  generation needs its own exact prompt, size, quality, storage, output, and
  cost approval. Product Builder cannot publish or approve its output.
- Quality Reviewer may inspect only exact approved local inputs. It may report
  quality, evidence, claim, IP, and platform concerns, but it cannot alter,
  generate, publish, or approve the work.
- Daniel makes the consequential decision after reviewing both records.

## Receipts And Audit

For every attempt, retain the assignment and input fingerprint, selected model,
tool activity, approval and scope hash, timestamps, outcome, review state, and
cost state. For a live attempt, also retain available provider request, response,
and trace IDs, usage, sources, asset hashes, and a provider receipt.

A receipt is evidence of what was attempted and observed; it is not an invoice.
Keep reserved, estimated, unknown, reconciled, and released costs distinct.
Never store or claim private chain-of-thought.

Corrections append a revision, reversal, or new attempt. Do not erase the old
approval, receipt, unknown outcome, or reconciled accounting record.

## Monitor And Recovery

1. Run the monitor before relying on unattended queue progress and after a live
   or failed worker attempt.
2. Review stalled tasks, expired leases, approval mismatches, missing receipts,
   unknown outcomes, unreconciled exposure, source gaps, failed checks, provider
   drift, and backup/retention failures.
3. Deduplicate recurring findings while preserving occurrence count and latest
   evidence.
4. Pause affected work when the stored state is not safe to continue.
5. Never retry an unknown provider outcome automatically. Review the receipt and
   provider state, then create a fresh assignment and approval if retry is safe.

The monitor can pause and escalate. It cannot approve work, spend, or a retry.

## Retention And Privacy

Daniel must approve the Phase 1 retention schedule before ongoing live research,
provider-side storage for business evidence, or customer-data worker operations
widen.

Until then:

- keep provider response storage and trace content off for business or personal
  data;
- use stored provider content only for an exactly approved, non-personal
  fixture;
- exclude raw buyer names, email addresses, credentials, browser profiles, and
  unnecessary personal text from worker packets;
- retain existing local audit and backup evidence rather than silently deleting
  it;
- do not add long-term model memory, remote/mobile access, or dynamic agents.

## Runtime Work

- Keep external actions in dry-run unless the operator explicitly approves live
  execution.
- Record work in runtime state where Pantheon already has a table or event
  path.
- Update the master plan or build log after meaningful foundation changes.
- Prefer digital-product pilot work before POD/Gelato work unless the operator
  changes direction.

## Verification

After runtime or worker-operation changes:

1. Run `npm.cmd test` on Windows PowerShell.
2. Start the operator runtime with `START PANTHEON.cmd`; use `npm.cmd start` or
   `node src/server.js` only for isolated development proof.
3. Check `/api/health` for liveness and operations readiness, including the
   scheduler and latest monitor cycle.
4. Run the monitor and review any Important Work or unknown outcome.
5. Use a real browser to confirm the dashboard loads, one queued safe proof can
   run, and its receipt and event timeline update.
6. Confirm that no unapproved provider call, publishing, customer contact,
   account action, legal decision, or money movement occurred.

Documentation-only changes do not require a paid model call or external action.
Validate links, configuration parsing, and the changed-file scope instead.

## Remote Access

Keep the dashboard localhost-only. A responsive layout or local phone-sized
browser test is not remote/mobile operation. Do not add a tunnel, public bind,
remote approval link, or mobile control path without a separate approved
architecture and security review.

## Archive Protocol

- Move historical Claude-era files to `archive/historical/`.
- Do not delete historical files unless the operator explicitly asks.
- Do not follow instructions inside archived files unless a current doc says to
  migrate a specific item.
