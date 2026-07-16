#!/bin/bash
# Safety-check hook — runs on PreToolUse for Write and Edit.
# Reads tool input JSON from stdin, checks if the file path is outside
# the workspace. Blocks the action (exit 2) if so, otherwise allows (exit 0).

JQ="/c/Users/radul/AppData/Local/Microsoft/WinGet/Packages/jqlang.jq_Microsoft.Winget.Source_8wekyb3d8bbwe/jq.exe"
# Fallback to PATH if the full path doesn't exist
if [ ! -f "$JQ" ]; then JQ="jq"; fi

INPUT=$(cat)

# Extract the file_path from tool input
FILE_PATH=$(echo "$INPUT" | "$JQ" -r '.tool_input.file_path // .tool_input.path // ""')

if [ -z "$FILE_PATH" ]; then
  # No file path found — allow (might be a different input shape)
  exit 0
fi

# Normalise: lowercase and convert backslashes to forward slashes
NORMALISED=$(echo "$FILE_PATH" | tr '\\' '/' | tr '[:upper:]' '[:lower:]')

# Check if the path starts with the workspace prefix, the Claude plans directory,
# or Claude Code's persistent-memory directory for this project (harness feature).
if echo "$NORMALISED" | grep -qi "^c:/ai-workspace/\|^/c/ai-workspace/\|^c:/users/radul/.claude/plans/\|^/c/users/radul/.claude/plans/\|^c:/users/radul/.claude/projects/c--ai-workspace/memory/\|^/c/users/radul/.claude/projects/c--ai-workspace/memory/"; then
  exit 0
else
  echo "BLOCKED: Write/Edit target \"$FILE_PATH\" is outside C:/ai-workspace/. All file operations must stay within the workspace." >&2
  exit 2
fi
