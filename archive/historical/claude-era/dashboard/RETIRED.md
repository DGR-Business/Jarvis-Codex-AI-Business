# Dashboard — RETIRED 2026-07-03 (Phase 1)

The dashboard server is no longer started or fed events. Reasons (audit finding #3):
- `server.listen(PORT)` bound ALL network interfaces with NO authentication — anyone on
  the LAN could hit approve/deny endpoints and the file-serving route (no path-traversal
  guards on `filename` inputs).
- Its approval function is superseded: Stage-1 review happens interactively in-session
  (Foundation Charter), and the hook that auto-started this server on every tool call
  (`dashboard-hook.sh`) has been unwired from `.claude/settings.json`.

Files are kept for reference/git history. `start-dashboard.bat` renamed to
`.retired`. Do NOT re-enable without adding: 127.0.0.1 binding, token auth, and
filename sanitisation. hooks/dashboard-hook.sh is also retired (no longer referenced).
