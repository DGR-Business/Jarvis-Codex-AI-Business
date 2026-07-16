#!/bin/bash
# Session-end hook — runs on Stop.
# 1. Checks for today's session log. If missing, blocks stop with a reminder.
# 2. Rotates activity.log to keep last 500 lines.

WORKSPACE="c:/ai-workspace"
TODAY=$(date +"%Y-%m-%d")

# Rotate activity.log — keep last 500 lines to prevent unbounded growth
ACTIVITY_LOG="$WORKSPACE/logs/activity.log"
if [ -f "$ACTIVITY_LOG" ]; then
  LINE_COUNT=$(wc -l < "$ACTIVITY_LOG" 2>/dev/null || echo 0)
  if [ "$LINE_COUNT" -gt 500 ]; then
    tail -500 "$ACTIVITY_LOG" > "$ACTIVITY_LOG.tmp" && mv "$ACTIVITY_LOG.tmp" "$ACTIVITY_LOG"
  fi
fi

# Check if session log for today exists
if ls "$WORKSPACE/memory/session-log-${TODAY}"*.md 1>/dev/null 2>&1; then
  # Session log exists — allow stop
  exit 0
else
  echo "REMINDER: Before ending, write TWO files to memory/:" >&2
  echo "  1. session-summary-${TODAY}.md  — compact (max 25 lines): key decisions, blockers, next session priorities" >&2
  echo "  2. session-log-${TODAY}-HHMM.md — full detail: everything done this session" >&2
  echo "Also update the active venture's current-state.md." >&2
  exit 2
fi
