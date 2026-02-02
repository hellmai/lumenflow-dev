#!/bin/bash
#
# enforce-worktree.sh
#
# Claude PreToolUse hook that blocks Write/Edit operations on main branch.
#
# This hook enforces worktree discipline for Claude Code specifically,
# complementing the git pre-commit hook for stronger enforcement.
#
# Exit codes:
#   0 = Allow operation
#   2 = Block operation (stderr shown to Claude as guidance)
#
# Security: Fail-open design for this hook (branches can't always be detected)
#   - If branch detection fails, allow operation (git hooks will catch it)
#   - If JSON parse fails, allow operation (defensive, log warning)
#
# Blocking conditions:
#   - Current branch is main or master
#   - Tool is Write or Edit
#   - Target file is in the main repo (not a worktree)
#

set -euo pipefail

# Derive repo paths from CLAUDE_PROJECT_DIR
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  MAIN_REPO_PATH="$CLAUDE_PROJECT_DIR"
else
  MAIN_REPO_PATH=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -z "$MAIN_REPO_PATH" ]]; then
    # Not in a git repo - allow operation
    exit 0
  fi
fi

# Check if we're on main/master branch
CURRENT_BRANCH=$(git -C "$MAIN_REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# If branch detection fails, fail-open (git hooks will catch issues)
if [[ -z "$CURRENT_BRANCH" ]]; then
  exit 0
fi

# Allow operations on non-main branches
case "$CURRENT_BRANCH" in
  main|master)
    # Continue to check tool type
    ;;
  *)
    # Not on main/master - allow
    exit 0
    ;;
esac

# Read JSON input from stdin
INPUT=$(cat)

# If no input, fail-open (defensive)
if [[ -z "$INPUT" ]]; then
  exit 0
fi

# Parse JSON with Python to extract tool_name and file_path
PARSE_RESULT=$(python3 -c "
import json
import sys
try:
    data = json.loads('''$INPUT''')
    tool_name = data.get('tool_name', '')
    tool_input = data.get('tool_input', {})
    if not isinstance(tool_input, dict):
        tool_input = {}
    file_path = tool_input.get('file_path', '')
    print('OK')
    print(tool_name if tool_name else '')
    print(file_path if file_path else '')
except Exception as e:
    print('ERROR')
    print(str(e))
    print('')
" 2>&1)

# Parse the result
PARSE_STATUS=$(echo "$PARSE_RESULT" | head -1)
TOOL_NAME=$(echo "$PARSE_RESULT" | sed -n '2p')
FILE_PATH=$(echo "$PARSE_RESULT" | sed -n '3p')

# If parse failed, fail-open (defensive)
if [[ "$PARSE_STATUS" != "OK" ]]; then
  exit 0
fi

# Only block Write and Edit tools
if [[ "$TOOL_NAME" != "Write" && "$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

# Check if file path is in a worktree (allowed) or main repo (blocked)
WORKTREES_DIR="${MAIN_REPO_PATH}/worktrees"

if [[ -n "$FILE_PATH" ]]; then
  RESOLVED_PATH=$(realpath -m "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")

  # Allow if path is inside a worktree
  if [[ "$RESOLVED_PATH" == "${WORKTREES_DIR}/"* ]]; then
    exit 0
  fi
fi

# Block: We're on main/master and trying to Write/Edit outside a worktree
echo "" >&2
echo "=== LumenFlow Worktree Enforcement ===" >&2
echo "" >&2
echo "BLOCKED: ${TOOL_NAME} operation on main branch" >&2
echo "" >&2
echo "You are on the '${CURRENT_BRANCH}' branch. Direct edits to main are not allowed." >&2
echo "" >&2
echo "WHAT TO DO:" >&2
echo "  1. Claim a WU to create a worktree:" >&2
echo "     pnpm wu:claim --id WU-XXXX --lane \"<Lane>\"" >&2
echo "" >&2
echo "  2. Move to the worktree:" >&2
echo "     cd worktrees/<lane>-wu-xxxx" >&2
echo "" >&2
echo "  3. Make your edits in the worktree" >&2
echo "" >&2
echo "WHY THIS MATTERS:" >&2
echo "  - Worktrees isolate your changes from other work" >&2
echo "  - All changes are tracked through the WU workflow" >&2
echo "  - Parallel work across lanes stays independent" >&2
echo "" >&2
echo "See: LUMENFLOW.md for complete workflow documentation" >&2
echo "========================================" >&2
exit 2
