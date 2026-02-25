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

  # Try to regenerate fresh recovery context (WU-2157: richer output)
  # mem:recover now includes acceptance criteria, code_paths, and git diff stat
  FRESH_RECOVERY=$(pnpm mem:recover --wu "$WU_ID" --quiet 2>/dev/null || echo "")

  if [[ -n "$FRESH_RECOVERY" ]]; then
    # Use freshly generated context (includes latest checkpoint + WU metadata)
    echo "$FRESH_RECOVERY" >&2
  else
    # Fallback to the pre-saved recovery file
    cat "$recovery_file" >&2
  fi

  echo "" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "" >&2

  # Remove after displaying (one-time recovery)
  rm -f "$recovery_file"
done

# Additional context if recovery was displayed
if [[ "$FOUND_RECOVERY" == "true" ]]; then
  echo "IMPORTANT: Your context was compacted. Review the recovery info above." >&2
  echo "Continue working on the WU using the acceptance criteria and code paths provided." >&2
  echo "" >&2
fi

exit 0
