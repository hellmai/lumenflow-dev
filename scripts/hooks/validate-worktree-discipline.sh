#!/bin/bash
#
# validate-worktree-discipline.sh
#
# Husky pre-commit hook to enforce worktree discipline.
# Prevents committing to the main repository when active worktrees exist.
#
# Features:
# - Blocks main repo commits when worktrees exist
# - Respects LUMENFLOW_HEADLESS (CI/Bots)
# - Respects Agent Branches (is-agent-branch.js)
# - Audit logging
#

set -euo pipefail

# Configuration
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || echo ".")
WORKTREES_DIR="${REPO_ROOT}/worktrees"
AUDIT_LOG_DIR="${REPO_ROOT}/.lumenflow"
AUDIT_LOG="${AUDIT_LOG_DIR}/safety-blocks.log"

# Setup audit logging
mkdir -p "$AUDIT_LOG_DIR"

log_audit() {
    local reason="$1"
    local context="$2"
    local timestamp
    timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
    echo "${timestamp}|BLOCKED|${reason}|${context}" >> "$AUDIT_LOG"
}

# 1. Headless Bypass
# Requires LUMENFLOW_HEADLESS=1 AND (LUMENFLOW_ADMIN=1 OR CI/GitHub Actions)
if [[ "${LUMENFLOW_HEADLESS:-}" == "1" ]]; then
  if [[ "${LUMENFLOW_ADMIN:-}" == "1" ]] || [[ -n "${CI:-}" ]] || [[ -n "${GITHUB_ACTIONS:-}" ]]; then
    exit 0
  fi
fi

# 2. Check for Worktrees
if [[ ! -d "$WORKTREES_DIR" ]]; then
  exit 0
fi

WORKTREE_COUNT=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [[ "$WORKTREE_COUNT" -eq 0 ]]; then
  exit 0
fi

# 3. We are in main repo AND worktrees exist.
#    Check if we are on an allowed "Agent Branch" (e.g. initial claim)

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Simple fallback check
if [[ "$CURRENT_BRANCH" == tmp/* ]]; then
    exit 0
fi

# Robust check using CLI helper
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

# 4. BLOCK THE COMMIT
ACTIVE_WORKTREES=$(find "$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | head -5 | tr '\n' ', ' | sed 's/,$//')

log_audit "worktree_discipline_violation" "branch=${CURRENT_BRANCH}, worktrees=${ACTIVE_WORKTREES}"

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
