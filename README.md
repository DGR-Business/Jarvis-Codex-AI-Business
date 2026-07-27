# Pantheon

Pantheon is Daniel's local, desktop-first AI business operating system. Jarvis
is the Codex-based developer and IT engineer responsible for building,
monitoring, maintaining, and improving Pantheon.

## Start Pantheon

Double-click `START PANTHEON.cmd` in this folder.

It starts the full local runtime and scheduler, waits until Pantheon is ready,
and opens the dashboard at `http://127.0.0.1:5051/`.

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

It stops every launcher-owned Pantheon production or rehearsal instance. It
verifies the exact executable, process start time, Windows owner, instance,
listener, and port before stopping anything, so unrelated Node programs are
left alone. Runtime logs and temporary ownership records stay under the ignored
`tmp/` folder and never enter Git.

## Check And Back Up

- Double-click `CHECK PANTHEON.cmd` to verify dependencies, database integrity,
  encryption, and the latest recovery set.
- Double-click `BACK UP PANTHEON.cmd` to create and verify a coherent encrypted
  source, database, artifact, operator-pack, and private-reference recovery set
  in the configured OneDrive folder.

## Project Direction

The living roadmap is in `docs/Pantheon Master Plan.md`. Meaningful build
history and proof results are in `docs/Pantheon Build Log.md`. The current
release evidence and honest capability limits are in
`docs/proofs/2026-07-18-pantheon-release-proof.md`.
