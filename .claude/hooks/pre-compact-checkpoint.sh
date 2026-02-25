#!/bin/bash
#
# pre-compact-checkpoint.sh
#
# PreCompact hook - auto-checkpoint + durable recovery marker (WU-1390)
#
# Fires before context compaction to:
# 1. Save a checkpoint with the current WU progress
# 2. Write a durable recovery file that survives compaction
#
# The recovery file is read by session-start-recovery.sh on the next
# session start (after compact, resume, or clear) to restore context.
#
# Exit codes:
#   0 = Always allow (cannot block compaction)
#
# Uses python3 for JSON parsing (consistent with other hooks)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Derive repo paths from CLAUDE_PROJECT_DIR
if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
  REPO_PATH="$CLAUDE_PROJECT_DIR"
else
  REPO_PATH=$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -z "$REPO_PATH" ]]; then
    exit 0
  fi
fi

# Read JSON input from stdin
INPUT=$(cat)

# Parse trigger from hook input (defensive - default to "auto")
# PreCompact provides: { "trigger": "manual" | "auto" }
TRIGGER=$(python3 -c "
import json
import sys
try:
    data = json.loads('''$INPUT''')
    trigger = data.get('trigger', 'auto')
    print(trigger if trigger else 'auto')
except:
    print('auto')
" 2>/dev/null || echo "auto")

# Get WU ID from worktree context (wu:status --json)
# Location.worktreeWuId is set when in a worktree
WU_ID=$(pnpm wu:status --json 2>/dev/null | python3 -c "
import json
import sys
try:
    data = json.load(sys.stdin)
    location = data.get('location', {})
    wu_id = location.get('worktreeWuId') or ''
    print(wu_id)
except:
    print('')
" 2>/dev/null || echo "")

# Only proceed if we have a WU ID (working in a worktree)
if [[ -n "$WU_ID" ]]; then
  # Capture git diff --stat for recovery context (WU-2157)
  # Shows which files have been modified since the branch diverged from main
  GIT_DIFF_STAT=$(git diff --stat HEAD 2>/dev/null || echo "")

  # Build checkpoint command with optional git diff stat
  CHECKPOINT_ARGS=("Auto: pre-${TRIGGER}-compaction" --wu "$WU_ID" --trigger "pre-compact" --quiet)
  if [[ -n "$GIT_DIFF_STAT" ]]; then
    CHECKPOINT_ARGS+=(--git-diff-stat "$GIT_DIFF_STAT")
  fi

  # Save checkpoint with pre-compact trigger
  # Note: This may fail if CLI not built, but that's OK - recovery file is more important
  pnpm mem:checkpoint "${CHECKPOINT_ARGS[@]}" 2>/dev/null || true

  # Write durable recovery marker (survives compaction)
  # This is the key mechanism - file persists and is read by session-start-recovery.sh
  RECOVERY_DIR="${REPO_PATH}/.lumenflow/state"
  RECOVERY_FILE="${RECOVERY_DIR}/recovery-pending-${WU_ID}.md"

  mkdir -p "$RECOVERY_DIR"

  # Generate recovery context using mem:recover
  # The --quiet flag outputs only the recovery context without headers
  pnpm mem:recover --wu "$WU_ID" --quiet > "$RECOVERY_FILE" 2>/dev/null || {
    # Fallback minimal recovery if mem:recover fails
    cat > "$RECOVERY_FILE" << EOF
# POST-COMPACTION RECOVERY

You are resuming work after context compaction. Your previous context was lost.
**WU:** ${WU_ID}

## Next Action
Run \`pnpm wu:brief --id ${WU_ID} --client claude-code\` to generate a fresh agent prompt with full context.
EOF
  }

  # Output brief warning to stderr (may be compacted away, but recovery file persists)
  echo "" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "⚠️  COMPACTION: Checkpoint saved for ${WU_ID}" >&2
  echo "Recovery context: ${RECOVERY_FILE}" >&2
  echo "Next: pnpm wu:brief --id ${WU_ID} --client claude-code" >&2
  echo "═══════════════════════════════════════════════════════" >&2
fi

# Always exit 0 - cannot block compaction
exit 0
