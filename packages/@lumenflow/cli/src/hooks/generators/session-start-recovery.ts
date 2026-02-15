/**
 * @file generators/session-start-recovery.ts
 * Generate the session-start-recovery.sh hook script content (WU-1394).
 *
 * Extracted from enforcement-generator.ts by WU-1645.
 */

/**
 * Generate the session-start-recovery.sh hook script content.
 *
 * This SessionStart hook checks for pending recovery files written by
 * pre-compact-checkpoint.sh and displays the recovery context to the agent.
 * After displaying, the recovery file is deleted (one-time recovery).
 *
 * Part of WU-1394: Durable recovery pattern for context preservation.
 */
export function generateSessionStartRecoveryScript(): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
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
if [[ -n "\${CLAUDE_PROJECT_DIR:-}" ]]; then
  REPO_PATH="\$CLAUDE_PROJECT_DIR"
else
  REPO_PATH=\$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -z "\$REPO_PATH" ]]; then
    exit 0
  fi
fi

RECOVERY_DIR="\${REPO_PATH}/.lumenflow/state"

# Check if recovery directory exists
if [[ ! -d "\$RECOVERY_DIR" ]]; then
  exit 0
fi

# Find any pending recovery files
FOUND_RECOVERY=false

for recovery_file in "\$RECOVERY_DIR"/recovery-pending-*.md; do
  # Check if glob matched any files (bash glob returns literal pattern if no match)
  [[ -f "\$recovery_file" ]] || continue

  FOUND_RECOVERY=true

  # Extract WU ID from filename for display
  WU_ID=\$(basename "\$recovery_file" | sed 's/recovery-pending-\\(.*\\)\\.md/\\1/')

  echo "" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "⚠️  POST-COMPACTION RECOVERY DETECTED" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "" >&2

  # Display the recovery context
  cat "\$recovery_file" >&2

  echo "" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "" >&2

  # Remove after displaying (one-time recovery)
  rm -f "\$recovery_file"
done

# Additional context if recovery was displayed
if [[ "\$FOUND_RECOVERY" == "true" ]]; then
  echo "IMPORTANT: Your context was compacted. Review the recovery info above." >&2
  echo "Recommended: Run 'pnpm wu:brief --id \$WU_ID --client \${LUMENFLOW_CLIENT:-claude-code}' for fresh full context." >&2
  echo "" >&2
fi

# WU-1473: Surface unread coordination signals for non-worktree orchestrators
# Even without recovery files, agents benefit from seeing recent inbox activity
# This supports orchestrators running from main checkout (not in a worktree)
pnpm mem:inbox --since 1h --unread-only --quiet 2>/dev/null >&2 || true

exit 0
`;
  /* eslint-enable no-useless-escape */
}
