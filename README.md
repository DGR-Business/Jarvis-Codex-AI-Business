# Pantheon

Pantheon is Daniel's local, desktop-first AI business operating system. Jarvis
is the Codex-based developer and IT engineer responsible for building,
monitoring, maintaining, and improving Pantheon.

## Start Pantheon

Double-click `START PANTHEON.cmd` in this folder.

It starts the full local runtime and scheduler, waits until Pantheon is ready,
and opens the dashboard at `http://127.0.0.1:5051/`.

Normal startup loads the protected `OPENAI_API_KEY` profile and preferred
`PANTHEON_*` settings from the Windows user environment. Legacy `JARVIS_*`
settings remain readable during migration. Internal AI work and read-only
research operate within the recorded monthly mandate. Publishing, customer
contact, account actions, money movement, legal decisions, and unapproved spend
remain protected.

## Stop Pantheon

Double-click `STOP PANTHEON.cmd`.

The stop shortcut only closes the Pantheon process recorded by the start shortcut.
Runtime logs and the temporary process record stay under the ignored `tmp/`
folder and never enter Git.

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
