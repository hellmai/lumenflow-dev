#!/bin/bash
#
# validate-worktree-path.sh
#
# PreToolUse hook that enforces worktree discipline for Write/Edit tools.
#
# Prevents writing to main repo when worktrees exist - edits should go
# to the worktree for the active WU.
#
# Exit codes:
#   0 = Allow operation
#   2 = Block operation (stderr shown to Claude as guidance)
#

set -euo pipefail

# Derive repo paths from CLAUDE_PROJECT_DIR
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  MAIN_REPO_PATH="$CLAUDE_PROJECT_DIR"
else
  MAIN_REPO_PATH=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -z "$MAIN_REPO_PATH" ]]; then
    exit 0
  fi
fi

WORKTREES_DIR="${MAIN_REPO_PATH}/worktrees"

# Read JSON input from stdin
INPUT=$(cat)

# Parse JSON with Python
TMPFILE=$(mktemp)
echo "$INPUT" > "$TMPFILE"

PARSED=$(python3 -c "
import json
try:
    with open('$TMPFILE', 'r') as f:
        data = json.load(f)
    tool_name = data.get('tool_name', '')
    file_path = data.get('tool_input', {}).get('file_path', '')
    print(tool_name)
    print(file_path)
except Exception:
    print('')
    print('')
" 2>/dev/null) || PARSED=$'\n'

rm -f "$TMPFILE"

TOOL_NAME=$(echo "$PARSED" | head -1)
FILE_PATH=$(echo "$PARSED" | tail -n +2 | head -1)

# Only process Write and Edit tools
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# Skip if no file path
if [[ -z "$FILE_PATH" ]]; then
  exit 0
fi

# Check if any worktrees exist
if [[ ! -d "$WORKTREES_DIR" ]]; then
  exit 0
fi

WORKTREE_COUNT=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [[ "$WORKTREE_COUNT" -eq 0 ]]; then
  exit 0
fi

# Worktrees exist - check if the file path is within a worktree
RESOLVED_PATH=$(realpath -m "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")

# Allow if path is inside a worktree
if [[ "$RESOLVED_PATH" == "${WORKTREES_DIR}/"* ]]; then
  exit 0
fi

# Block if path is in main repo while worktrees exist
if [[ "$RESOLVED_PATH" == "${MAIN_REPO_PATH}/"* || "$RESOLVED_PATH" == "${MAIN_REPO_PATH}" ]]; then
  ACTIVE_WORKTREES=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | head -5 | tr '\n' ', ' | sed 's/,$//')

  echo "" >&2
  echo "=== Worktree Discipline Enforcement ===" >&2
  echo "" >&2
  echo "BLOCKED: ${TOOL_NAME} to ${FILE_PATH}" >&2
  echo "" >&2
  echo "REASON: Cannot write to main repo while worktrees exist." >&2
  echo "Active worktrees: ${ACTIVE_WORKTREES:-none detected}" >&2
  echo "" >&2
  echo "USE INSTEAD:" >&2
  echo "  1. cd to your worktree: cd worktrees/<lane>-wu-<id>/" >&2
  echo "  2. Make your edits in the worktree" >&2
  echo "" >&2
  echo "See: docs/lumenflow/playbook.md for WU workflow" >&2
  echo "========================================" >&2
  exit 2
fi

# Path is outside repo entirely - allow
exit 0
