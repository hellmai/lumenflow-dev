#!/bin/bash
#
# warn-dirty-main.sh (WU-1502)
#
# PostToolUse hook for the Bash tool.
# Detects file modifications on main checkout after Bash commands
# and emits a high-signal warning listing changed paths.
#
# No-op inside worktrees. Always exits 0 (warning only, never blocks).
# Clean working tree overhead: <50ms (single git status call).
#
# Exit codes:
#   0 = Always (warnings only, never blocks)
#

# Fail-open: errors must never block Bash execution
set +e

# Derive repo paths
if [[ -z "${CLAUDE_PROJECT_DIR:-}" ]]; then
  exit 0
fi

REPO_PATH="$CLAUDE_PROJECT_DIR"
WORKTREES_DIR="${REPO_PATH}/worktrees"
LUMENFLOW_DIR="${REPO_PATH}/.lumenflow"

# No-op if LumenFlow is not configured
if [[ ! -d "$LUMENFLOW_DIR" ]]; then
  exit 0
fi

# Read JSON input from stdin (PostToolUse provides tool_name + tool_input)
INPUT=$(cat 2>/dev/null || true)

# Verify this is a Bash tool call (defensive: matcher should already filter)
if [[ -n "$INPUT" ]]; then
  TOOL_NAME=$(echo "$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")

  if [[ "$TOOL_NAME" != "Bash" ]]; then
    exit 0
  fi
fi

# No-op inside worktrees
CWD=$(pwd 2>/dev/null || echo "")
if [[ "$CWD" == "${WORKTREES_DIR}/"* ]]; then
  exit 0
fi

# Only warn on main branch
CURRENT_BRANCH=$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  exit 0
fi

# Check for dirty working tree (modified/untracked files)
DIRTY_LINES=$(git -C "$REPO_PATH" status --porcelain --untracked-files=all 2>/dev/null || true)
if [[ -z "$DIRTY_LINES" ]]; then
  exit 0
fi

# Emit warning with changed paths
echo "" >&2
echo "=== Dirty Main Warning (WU-1502) ===" >&2
echo "" >&2
echo "WARNING: Bash command modified files on main checkout." >&2
echo "" >&2
echo "Modified paths:" >&2
echo "$DIRTY_LINES" | head -20 | sed 's/^/  /' >&2
LINE_COUNT=$(echo "$DIRTY_LINES" | wc -l | tr -d ' ')
if [[ $LINE_COUNT -gt 20 ]]; then
  echo "  ... ($LINE_COUNT total, showing first 20)" >&2
fi
echo "" >&2
echo "WHAT TO DO:" >&2
echo "  1. If intentional: claim a WU and move changes to a worktree" >&2
echo "     pnpm wu:claim --id WU-XXXX --lane \"<Lane>\"" >&2
echo "  2. If accidental: discard the changes" >&2
echo "     git checkout -- . && git clean -fd" >&2
echo "" >&2
echo "Main should stay clean. See: LUMENFLOW.md" >&2
echo "=======================================" >&2

exit 0
