# Jarvis-Codex AI Business

## Start Jarvis

Double-click `START JARVIS.cmd` in this folder.

It starts the full local runtime and scheduler, waits until the system is ready,
and opens the dashboard at `http://127.0.0.1:5051/`.

Normal startup is protected: no OpenAI key is loaded, live model calls are off,
and publishing, customer contact, account actions, and spend still require the
normal approvals.

## Stop Jarvis

Double-click `STOP JARVIS.cmd`.

The stop shortcut only closes the Jarvis process recorded by the start shortcut.
Runtime logs and the temporary process record stay under the ignored `tmp/`
folder and never enter Git.

## Project Direction

The living roadmap is in `docs/Jarvis-Codex Master Plan.md`. Meaningful build
history and proof results are in `docs/Jarvis-Codex Build Log.md`.
