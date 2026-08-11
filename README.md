# Pantheon

Pantheon is Daniel's local, desktop-first AI business operating system. Jarvis
is the Codex-based developer and IT engineer responsible for building,
monitoring, maintaining, and improving Pantheon.

Pantheon's destination is a governed operating machine that can build and run
multiple business ventures in parallel. Its current stage is deliberately
narrower: find and prove the first venture, including three independent paying
buyers and positive net cash contribution, before opening concurrent venture
lanes. That sequencing is a risk gate, not a reduction of the long-term
mission.

## Start Pantheon

Double-click `START PANTHEON.cmd` in this folder.

It starts Pantheon's lightweight Standby control shell and opens the dashboard
at `http://127.0.0.1:5050/`. Standby keeps the cockpit available without
loading the scheduler, Agents SDK workers, or writable business runtime. Use
**Start working** in the dashboard when Pantheon needs the full runtime on port
5051, and **Return to standby** when the work is finished.

Normal startup loads the OpenAI key from the Windows-user-protected credential
at `%LOCALAPPDATA%\Pantheon\openai-credential.json`. The file contains only
Windows DPAPI ciphertext and is restricted to the signed-in Windows account and
SYSTEM. Connecting OpenAI is a one-time setup for that Windows account; repeat
it only when rotating the key or moving Pantheon to another account or machine.
Environment variables remain a development fallback, and legacy `JARVIS_*`
settings remain readable during migration. Internal AI work and read-only
research operate within the recorded monthly mandate. Publishing, customer
contact, account actions, money movement, legal decisions, and unapproved spend
remain protected.

For the isolated Full Journey rehearsal, double-click
`START PANTHEON REHEARSAL.cmd`. It uses separate state and opens on port 5052,
so rehearsal evidence cannot clutter the production dashboard.

Double-click `STATUS PANTHEON.cmd` at any time to see whether production or the
rehearsal is genuinely running.

## Stop Pantheon

Double-click `STOP PANTHEON.cmd`.

It stops the Standby shell, Working runtime, and every launcher-owned Pantheon
rehearsal instance. It verifies the exact executable, process start time,
Windows owner, instance, listener, and port before stopping anything, so
unrelated Node programs are left alone. Runtime logs and temporary ownership
records stay under the ignored `tmp/` folder and never enter Git.

## Check And Back Up

- Double-click `CHECK PANTHEON.cmd` to verify dependencies, database integrity,
  encryption, and the latest recovery set.
- Double-click `BACK UP PANTHEON.cmd` to create and verify a coherent encrypted
  source, database, artifact, operator-pack, and private-reference recovery set
  in the configured OneDrive folder.

Pantheon's locked JavaScript dependencies require Node.js 24. PDF, spreadsheet,
and storefront rendering use the pinned Python packages in
`requirements-runtime.txt`. Doctor verifies the complete renderer rather than
assuming a Python installation is usable.

As of 2026-08-11, the owner-approved technical recovery is complete: the live
database is current schema 27, the locked runtime and owner dashboard proof
passed, and active-key recovery set
`bdfab6e4-e765-47d0-830d-bfbef0532fe7` passed verification, disposable
restore, and Doctor. Pre-Venture Research Authority v1 is expired. Recovery did
not create v2 authority or permit provider use; any live research still needs a
new exact, time-bounded owner approval and authenticated attestation.

## Project Direction

The living roadmap is in `docs/Pantheon Master Plan.md`. Meaningful build
history and proof results are in `docs/Pantheon Build Log.md`. The current
release evidence and honest capability limits are in
`docs/proofs/2026-08-11-preventure-research-schema27-offline-recovery-proof.md`.
