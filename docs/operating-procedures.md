# Operating Procedures

## Session Start

1. Start Pantheon with `START PANTHEON.cmd` and use the secure control window it
   opens. Pantheon begins in **Standby**: the dashboard control shell is
   available while the scheduler, Agents SDK workers, monitoring, and writable
   business runtime remain unloaded. Select **Start working** when business work
   is needed. Select **Return to standby** when finished, or **Stop Pantheon** to
   stop the control shell as well. `STATUS PANTHEON.cmd` reports the current
   state, and `STOP PANTHEON.cmd` stops every exact launcher-owned process while
   leaving unrelated Node programs alone. A manually opened localhost tab is
   not an authenticated operator session.
   Use `START PANTHEON REHEARSAL.cmd` only for retained isolated Full Journey
   engineering proof.
   Pantheon reads OpenAI access from the Windows-user-protected credential under
   `%LOCALAPPDATA%\Pantheon`. Do not reconnect on normal starts. Use
   `scripts\configure-openai.ps1` only for initial setup, deliberate key
   rotation, disconnection, or a different Windows account or machine.
2. Confirm `/api/health` reports `alive`, `operationsReady`, a running
   scheduler, and a recent completed monitor check. `alive` alone means only
   that the local process is responding.
3. Read `docs/Pantheon Master Plan.md`.
4. Read `docs/Pantheon Build Log.md`.
5. For the active commercial gate, read
   `docs/plans/PANTHEON-COMMERCIAL-INTELLIGENCE-FOUNDATION-2026-07-27.md`,
   `docs/commercial/COMMERCIAL-CONSTITUTION.md`, and
   `docs/decisions/0006-autonomous-agent-operations-foundation.md`.
6. Check the active task against `AGENTS.md` and
   `docs/policies/OPERATOR-DELIVERY-AND-SECURITY.md`.
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

## Portfolio Sequence

1. Explore at least five materially different lawful opportunity spaces.
2. Retain model ideas as hypotheses, not market proof.
3. Give three eligible finalists comparable attributable demand and finance
   review.
4. Apply all mandatory commercial gates, compare alternatives and doing
   nothing, and allow a no-investment result.
5. Use one Sol Commercial Investment Review only after the deterministic case
   exists.
6. Stop after two bounded rounds. Do not repeat generic discovery or begin
   production without materially new evidence.

## Digital Product Journey Sequence

Use this only after an approved case selects `digital_product_v1`; it is not the
generic Pantheon workflow.

1. Run the isolated rehearsal before production-intent work when the kit version
   or production contract has materially changed.
2. Lock every specialist to Luna and the exact A$15 combined journey cap.
3. Let Opportunity Scout retain broad findings, then give three eligible
   candidates comparable Demand Validator review.
4. Persist each specialist result and handoff as its own resumable stage.
5. Allow one bounded correction per stage; stop on an unknown provider outcome.
6. Inspect exact product files, hashes, rendered previews, sources, claims,
   receipts, and costs before accepting the Quality Reviewer result.
7. Stop at Ready to publish. Account, KYC, upload, publication, customer
   contact, advertising, agreements, and money actions remain protected.

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

Daniel approved the current data-protection schedule. It is active and recorded
immutably in the runtime. Under that schedule:

- keep provider response storage and trace content off for business or personal
  data by default;
- never send credentials, raw identity records, or unnecessary direct customer
  identifiers to a model;
- exclude raw buyer names, email addresses, credentials, browser profiles, and
  unnecessary personal text from worker packets;
- apply the active seven-year, active-plus-three-year, ninety-day, and encrypted
  backup periods by record class;
- preview destructive maintenance separately; activation did not itself delete
  any record;
- require a new policy decision before long-term model memory, remote/mobile
  access, or dynamic agents.

## Runtime Work

- Keep external actions in dry-run unless the operator explicitly approves live
  execution.
- Record work in runtime state where Pantheon already has a table or event
  path.
- Update the master plan or build log after meaningful foundation changes.
- Prefer digital-product pilot work before POD/Gelato work unless the operator
  changes direction.

## OpenAI Connection

- Keep the API key outside the repository. Pantheon's authoritative local copy
  is Windows CurrentUser DPAPI ciphertext in
  `%LOCALAPPDATA%\Pantheon\openai-credential.json`, with an account-restricted
  folder ACL.
- The launcher may use a process or Windows user environment key only as a
  development or migration fallback. A protected Pantheon credential overrides
  that fallback.
- The legacy `private/runtime-credentials.json` file remains a recovery-settings
  compatibility source. Failure to decrypt an old backup or privacy secret must
  not disconnect an otherwise valid OpenAI connection.
- Rotate a key when exposure is suspected. Save the replacement through the
  protected connection workflow, prove startup without an environment key, then
  revoke the predecessor in OpenAI Platform.
- Never print, log, commit, place in a URL, or return the plaintext key from a
  health or status interface.

## Verification

After runtime or worker-operation changes:

1. Run `npm.cmd test` on Windows PowerShell.
2. Run `npm.cmd run lint`.
3. Start the operator runtime with `START PANTHEON.cmd`; use `npm.cmd start` or
   `node src/server.js` only for isolated development proof.
4. Check `/api/health` for liveness and operations readiness, including the
   scheduler and latest monitor cycle.
5. Run the monitor and review any Important Work or unknown outcome.
6. Use a real browser to confirm the dashboard loads, one queued safe proof can
   run, and its receipt and event timeline update.
7. Confirm that no unapproved provider call, publishing, customer contact,
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
