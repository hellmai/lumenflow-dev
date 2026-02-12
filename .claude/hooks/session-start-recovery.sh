#!/bin/bash
#
# session-start-recovery.sh
#
# SessionStart hook - check for pending recovery and inject context (WU-1390)
#
# Fires after session start (on compact, resume, or clear) to:
# 1. Check for recovery-pending-*.md files written by pre-compact-checkpoint.sh
# 2. Display the recovery context to the agent
# 3. Remove the recovery file (one-time recovery)
#
# This completes the durable recovery pattern:
#   PreCompact writes file → SessionStart reads and deletes it
#
# Exit codes:
#   0 = Always allow (informational hook)
#

set -euo pipefail

# Derive repo paths from CLAUDE_PROJECT_DIR
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  REPO_PATH="$CLAUDE_PROJECT_DIR"
else
  REPO_PATH=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -z "$REPO_PATH" ]]; then
    exit 0
  fi
fi

# WU-1505: Early warning for dirty main checkout at SessionStart.
# Informational only (never blocks), helps agents catch polluted main state
# before any work begins.
CWD=$(pwd)
WORKTREES_DIR="${REPO_PATH}/worktrees"
CURRENT_BRANCH=$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# No-op in worktrees and non-main branches.
if [[ "$CWD" != "${WORKTREES_DIR}/"* ]] && [[ "$CURRENT_BRANCH" == "main" ]]; then
  DIRTY_LINES=$(git -C "$REPO_PATH" status --porcelain --untracked-files=all 2>/dev/null || true)
  if [[ -n "$DIRTY_LINES" ]]; then
    echo "" >&2
    echo "═══════════════════════════════════════════════════════" >&2
    echo "⚠️  DIRTY MAIN CHECKOUT DETECTED" >&2
    echo "═══════════════════════════════════════════════════════" >&2
    echo "" >&2
    echo "Uncommitted files in main checkout:" >&2
    echo "$DIRTY_LINES" | head -20 | sed 's/^/  /' >&2
    if [[ $(echo "$DIRTY_LINES" | wc -l | tr -d ' ') -gt 20 ]]; then
      echo "  ... (truncated)" >&2
    fi
    echo "" >&2
    echo "Recommended next steps:" >&2
    echo "  1. Inspect: git status --short" >&2
    echo "  2. Move changes into a WU worktree or commit/discard intentionally" >&2
    echo "  3. Keep main clean before starting new work" >&2
    echo "" >&2
  fi
fi

RECOVERY_DIR="${REPO_PATH}/.lumenflow/state"

# Check if recovery directory exists
if [[ ! -d "$RECOVERY_DIR" ]]; then
  exit 0
fi

# Find any pending recovery files
FOUND_RECOVERY=false

for recovery_file in "$RECOVERY_DIR"/recovery-pending-*.md; do
  # Check if glob matched any files (bash glob returns literal pattern if no match)
  [[ -f "$recovery_file" ]] || continue

  FOUND_RECOVERY=true

  # Extract WU ID from filename for display
  WU_ID=$(basename "$recovery_file" | sed 's/recovery-pending-\(.*\)\.md/\1/')

  echo "" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "⚠️  POST-COMPACTION RECOVERY DETECTED" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "" >&2

  # Display the recovery context
  cat "$recovery_file" >&2

  echo "" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "" >&2

  # Remove after displaying (one-time recovery)
  rm -f "$recovery_file"
done

# Additional context if recovery was displayed
if [[ "$FOUND_RECOVERY" == "true" ]]; then
  echo "IMPORTANT: Your context was compacted. Review the recovery info above." >&2
  echo "Recommended: Run 'pnpm wu:brief --id $WU_ID --client claude-code' for fresh full context." >&2
  echo "" >&2
fi

exit 0
