# Jarvis-Codex AI Business

## Start Jarvis

Double-click `START JARVIS.cmd` in this folder.

It starts the full local runtime and scheduler, waits until the system is ready,
and opens the dashboard at `http://127.0.0.1:5051/`.

Normal startup loads approved `OPENAI_API_KEY` and `JARVIS_*` settings from the
Windows user environment. AI workers and read-only research can therefore run
from the dashboard when their exact cost-bound work is approved. Publishing,
customer contact, account actions, money movement, legal decisions, and spend
outside an approved cap remain blocked.

## Stop Jarvis

Double-click `STOP JARVIS.cmd`.

The stop shortcut only closes the Jarvis process recorded by the start shortcut.
Runtime logs and the temporary process record stay under the ignored `tmp/`
folder and never enter Git.

## Project Direction

The living roadmap is in `docs/Jarvis-Codex Master Plan.md`. Meaningful build
history and proof results are in `docs/Jarvis-Codex Build Log.md`.
