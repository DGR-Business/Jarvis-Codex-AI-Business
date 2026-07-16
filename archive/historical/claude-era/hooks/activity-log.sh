#!/bin/bash
# Activity log hook — appends tool usage to logs/activity.log for dashboard.
# Called as PostToolUse hook (async: true).

JQ="/c/Users/radul/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe/jq.exe"
if [ ! -f "$JQ" ]; then JQ="jq"; fi

INPUT=$(cat)
LOGFILE="/c/ai-workspace/logs/activity.log"

TOOL=$(echo "$INPUT" | "$JQ" -r '.tool_name // "unknown"')
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

echo "$TIMESTAMP | tool-use | $TOOL" >> "$LOGFILE"
