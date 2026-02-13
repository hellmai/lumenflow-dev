/**
 * @file generators/warn-incomplete.ts
 * Generate the warn-incomplete.sh hook script content (WU-1367).
 *
 * Extracted from enforcement-generator.ts by WU-1645.
 */

/**
 * Generate the warn-incomplete.sh hook script content.
 *
 * This Stop hook warns when session ends without wu:done.
 * Always exits 0 (warning only, never blocks).
 */
export function generateWarnIncompleteScript(): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
#
# warn-incomplete.sh (WU-1367)
#
# Stop hook that warns when session ends without wu:done.
# This is advisory only - never blocks session termination.
#
# Exit codes:
#   0 = Always (warnings only)
#

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

if [[ -z "\${CLAUDE_PROJECT_DIR:-}" ]]; then
  exit 0
fi

MAIN_REPO_PATH="\$CLAUDE_PROJECT_DIR"
WORKTREES_DIR="\${MAIN_REPO_PATH}/worktrees"

# Check for active worktrees
if [[ ! -d "\$WORKTREES_DIR" ]]; then
  exit 0
fi

WORKTREE_COUNT=\$(find "\$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [[ "\$WORKTREE_COUNT" -eq 0 ]]; then
  exit 0
fi

# Get active worktree names
ACTIVE_WORKTREES=\$(find "\$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null | head -5 | tr '\\n' ', ' | sed 's/,\$//')

echo "" >&2
echo "=== Session Completion Reminder ===" >&2
echo "" >&2
echo "You have active worktrees: \$ACTIVE_WORKTREES" >&2
echo "" >&2
echo "If your work is complete, remember to run:" >&2
echo "  pnpm wu:prep --id WU-XXXX  (from worktree)" >&2
echo "  pnpm wu:done --id WU-XXXX  (from main)" >&2
echo "" >&2
echo "If work is incomplete, it will be preserved in the worktree." >&2
echo "====================================" >&2

exit 0
`;
  /* eslint-enable no-useless-escape */
}
