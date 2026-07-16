#!/bin/bash
# PostToolUseFailure hook — logs tool failures to logs/system.log for visibility.
# Called async on every tool failure.

JQ="/c/Users/radul/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe/jq.exe"
if [ ! -f "$JQ" ]; then JQ="jq"; fi

INPUT=$(cat)
LOGFILE="/c/ai-workspace/logs/system.log"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

TOOL=$(echo "$INPUT" | "$JQ" -r '.tool_name // "unknown"')
ERROR=$(echo "$INPUT" | "$JQ" -r '.error // "unknown error"' | head -c 200)

echo "$TIMESTAMP | TOOL-FAILURE | $TOOL | $ERROR" >> "$LOGFILE"
