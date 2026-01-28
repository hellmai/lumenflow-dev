#!/bin/bash
#
# validate-worktree-discipline.sh
#
# Husky pre-commit hook to enforce worktree discipline.
#
# Prevents committing to the main repository when active worktrees exist.
# Forces developers/agents to use worktrees for changes to prevent
# state conflicts and main branch pollution.
#

set -euo pipefail

# Get repository root
REPO_ROOT=$(git rev-parse --show-toplevel)
WORKTREES_DIR="${REPO_ROOT}/worktrees"

# If worktrees directory doesn't exist or is empty, we are safe.
# This also naturally handles the case where we ARE in a worktree,
# because a worktree root won't have a 'worktrees' subdirectory.
if [[ ! -d "$WORKTREES_DIR" ]]; then
  exit 0
fi

# Check if there are any actual worktree directories (not just empty dir)
WORKTREE_COUNT=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [[ "$WORKTREE_COUNT" -eq 0 ]]; then
  exit 0
fi

# If we are here, we are in the main repo AND there are active worktrees.

# Exception 1: Allow commits on designated "agent branches" (e.g. initial claim)
# We can delegate this check to the existing CLI tool if available, or check pattern directly.
# For now, let's use a simple pattern check as a fallback.
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$CURRENT_BRANCH" == tmp/* ]]; then
    exit 0
fi

# Path to built CLI helper for robust agent branch checking
IS_AGENT_BRANCH_CLI=""
for candidate in \
  "${REPO_ROOT}/node_modules/@lumenflow/core/dist/cli/is-agent-branch.js" \
  "${REPO_ROOT}/packages/@lumenflow/core/dist/cli/is-agent-branch.js"; do
  if [[ -f "$candidate" ]]; then
    IS_AGENT_BRANCH_CLI="$candidate"
    break
  fi
done

if [[ -n "$IS_AGENT_BRANCH_CLI" ]]; then
  if node "$IS_AGENT_BRANCH_CLI" "$CURRENT_BRANCH" 2>/dev/null; then
    exit 0
  fi
fi

# Block the commit
ACTIVE_WORKTREES=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | head -5 | tr '\n' ', ' | sed 's/,$//')

echo "" >&2
echo "=== LUMENFLOW WORKTREE DISCIPLINE ===" >&2
echo "" >&2
echo "BLOCKED: Cannot commit to main repository while worktrees exist." >&2
echo "" >&2
echo "Active worktrees detected: ${ACTIVE_WORKTREES}..." >&2
echo "" >&2
echo "REASON: Committing to main while worktrees are active causes state" >&2
echo "        inconsistency and potential data loss." >&2
echo "" >&2
echo "ACTION REQUIRED:" >&2
echo "  1. Switch to your active worktree:" >&2
echo "     cd worktrees/..." >&2
echo "  2. Make your changes and commit there." >&2
echo "  3. Use 'pnpm wu:done' to merge." >&2
echo "" >&2
echo "=====================================" >&2
exit 1
