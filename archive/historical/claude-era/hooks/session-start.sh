#!/bin/bash
# Session-start hook — runs on SessionStart.
# Loads the compact session SUMMARY (key decisions, blockers, next actions).
# Full session logs are in memory/session-log-*.md — load those only when doing
# a full review, audit, or historical reference.

WORKSPACE="c:/ai-workspace"

# Find the most recent compact summary
LATEST_SUMMARY=$(ls -1 "$WORKSPACE/memory/session-summary-"*.md 2>/dev/null | sort | tail -1)

if [ -n "$LATEST_SUMMARY" ]; then
  echo "=== SESSION SUMMARY: $(basename "$LATEST_SUMMARY") ==="
  cat "$LATEST_SUMMARY"
  echo ""
else
  # Fallback: tail of the most recent full session log (no summary written yet)
  LATEST_LOG=$(ls -1 "$WORKSPACE/memory/session-log-"*.md 2>/dev/null | sort | tail -1)
  if [ -n "$LATEST_LOG" ]; then
    echo "=== SESSION LOG (last 25 lines — no summary found): $(basename "$LATEST_LOG") ==="
    tail -25 "$LATEST_LOG"
    echo ""
  else
    echo "=== No previous session context found ==="
    echo ""
  fi
fi

# IDEAS.md is no longer auto-loaded. Check it when the operator requests idea review.
