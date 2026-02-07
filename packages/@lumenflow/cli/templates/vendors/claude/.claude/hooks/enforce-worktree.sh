#!/bin/bash
#
# enforce-worktree.sh (WU-1501)
#
# Claude PreToolUse hook that blocks Write/Edit operations on main branch.
# Fail-closed: blocks even when no worktrees exist (no unguarded main writes).
#
# This hook enforces worktree discipline for Claude Code specifically,
# complementing the git pre-commit hook for stronger enforcement.
#
# Exit codes:
#   0 = Allow operation
#   2 = Block operation (stderr shown to Claude as guidance)
#
# Security: Fail-closed on main when LumenFlow is configured
#   - Allowlist: docs/04-operations/tasks/wu/, .lumenflow/, .claude/, plan/
#   - Branch-PR claimed_mode permits writes from main checkout
#   - Graceful degradation only when LumenFlow is NOT configured
#
# Blocking conditions:
#   - Current branch is main or master
#   - Tool is Write or Edit
#   - Target file is in the main repo (not a worktree)
#   - No allowlisted path match
#   - No branch-pr WU in progress
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

WORKTREES_DIR="${MAIN_REPO_PATH}/worktrees"
LUMENFLOW_DIR="${MAIN_REPO_PATH}/.lumenflow"

# Graceful degradation: LumenFlow not configured
if [[ ! -d "$LUMENFLOW_DIR" ]]; then
  exit 0
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

# Resolve file path
if [[ -n "$FILE_PATH" ]]; then
  RESOLVED_PATH=$(realpath -m "$FILE_PATH" 2>/dev/null || echo "$FILE_PATH")
else
  RESOLVED_PATH=""
fi

# Allow if path is outside repo entirely
if [[ -n "$RESOLVED_PATH" ]]; then
  if [[ "$RESOLVED_PATH" != "${MAIN_REPO_PATH}/"* && "$RESOLVED_PATH" != "${MAIN_REPO_PATH}" ]]; then
    exit 0
  fi
fi

# Allow if path is inside a worktree
if [[ -n "$RESOLVED_PATH" && "$RESOLVED_PATH" == "${WORKTREES_DIR}/"* ]]; then
  exit 0
fi

# Check if any active worktrees exist
WORKTREE_COUNT=0
if [[ -d "$WORKTREES_DIR" ]]; then
  WORKTREE_COUNT=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
fi

# If worktrees exist, block writes to main repo (original behavior)
if [[ "$WORKTREE_COUNT" -gt 0 ]]; then
  echo "" >&2
  echo "=== LumenFlow Worktree Enforcement ===" >&2
  echo "" >&2
  echo "BLOCKED: ${TOOL_NAME} operation on main branch" >&2
  echo "" >&2
  echo "You are on the '${CURRENT_BRANCH}' branch. Direct edits to main are not allowed." >&2
  echo "" >&2
  echo "WHAT TO DO:" >&2
  echo "  1. cd to your worktree: cd worktrees/<lane>-wu-<id>/" >&2
  echo "  2. Make your edits in the worktree" >&2
  echo "" >&2
  echo "See: LUMENFLOW.md for complete workflow documentation" >&2
  echo "========================================" >&2
  exit 2
fi

# WU-1501: Fail-closed on main when no worktrees exist
# Check allowlist: paths that are always safe to write on main
if [[ -n "$RESOLVED_PATH" ]]; then
  RELATIVE_PATH="${RESOLVED_PATH#${MAIN_REPO_PATH}/}"

  case "$RELATIVE_PATH" in
    docs/04-operations/tasks/wu/*)  exit 0 ;;  # WU YAML specs
    .lumenflow/*)                   exit 0 ;;  # LumenFlow state/config
    .claude/*)                      exit 0 ;;  # Claude Code config
    plan/*)                         exit 0 ;;  # Plan/spec scaffolds
  esac
fi

# Check for branch-pr claimed_mode (allows main writes without worktree)
STATE_FILE="${LUMENFLOW_DIR}/state/wu-events.jsonl"
if [[ -f "$STATE_FILE" ]]; then
  if grep -q '"claimed_mode":"branch-pr"' "$STATE_FILE" 2>/dev/null; then
    if grep -q '"status":"in_progress"' "$STATE_FILE" 2>/dev/null; then
      exit 0  # Branch-PR WU active - allow main writes
    fi
  fi
fi

# Fail-closed: block the write
echo "" >&2
echo "=== LumenFlow Worktree Enforcement ===" >&2
echo "" >&2
echo "BLOCKED: ${TOOL_NAME} operation on main branch (no active WU claim)" >&2
echo "" >&2
echo "You are on the '${CURRENT_BRANCH}' branch with no active WU." >&2
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
echo "See: LUMENFLOW.md for complete workflow documentation" >&2
echo "========================================" >&2
exit 2
