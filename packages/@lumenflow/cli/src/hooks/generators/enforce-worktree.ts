/**
 * @file generators/enforce-worktree.ts
 * Generate the enforce-worktree.sh hook script content (WU-1367, WU-1501).
 *
 * Extracted from enforcement-generator.ts by WU-1645.
 */

/**
 * Generate the enforce-worktree.sh hook script content.
 *
 * WU-1501: Fail-closed on main. Blocks Write/Edit when no active claim context.
 * Graceful degradation only when LumenFlow is NOT configured.
 * Allowlist: docs/04-operations/tasks/wu/, .lumenflow/, .claude/, plan/
 * Branch-PR claimed_mode remains writable from main checkout.
 */
export function generateEnforceWorktreeScript(): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
#
# enforce-worktree.sh (WU-1367, WU-1501)
#
# PreToolUse hook that blocks Write/Edit on main checkout.
# WU-1501: Fail-closed - blocks even when no worktrees exist.
# Graceful degradation only when LumenFlow is NOT configured.
#
# Allowlist: docs/04-operations/tasks/wu/, .lumenflow/, .claude/, plan/
# Branch-PR claimed_mode permits writes from main checkout.
#
# Exit codes:
#   0 = Allow operation
#   2 = Block operation (stderr shown to Claude as guidance)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

# Graceful degradation: if we can't determine state, allow the operation
graceful_allow() {
  local reason="\$1"
  exit 0
}

# Derive repo paths from CLAUDE_PROJECT_DIR
if [[ -z "\${CLAUDE_PROJECT_DIR:-}" ]]; then
  graceful_allow "CLAUDE_PROJECT_DIR not set"
fi

MAIN_REPO_PATH="\$CLAUDE_PROJECT_DIR"
WORKTREES_DIR="\${MAIN_REPO_PATH}/worktrees"
LUMENFLOW_DIR="\${MAIN_REPO_PATH}/.lumenflow"

# Check if .lumenflow exists (LumenFlow is configured)
if [[ ! -d "\$LUMENFLOW_DIR" ]]; then
  graceful_allow "No .lumenflow directory (LumenFlow not configured)"
fi

# Read JSON input from stdin
INPUT=\$(cat)

if [[ -z "\$INPUT" ]]; then
  graceful_allow "No input provided"
fi

# Parse JSON with Python
TMPFILE=\$(mktemp)
echo "\$INPUT" > "\$TMPFILE"

PARSE_RESULT=\$(python3 -c "
import json
import sys
try:
    with open('\$TMPFILE', 'r') as f:
        data = json.load(f)
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

rm -f "\$TMPFILE"

# Parse the result
PARSE_STATUS=\$(echo "\$PARSE_RESULT" | head -1)
TOOL_NAME=\$(echo "\$PARSE_RESULT" | sed -n '2p')
FILE_PATH=\$(echo "\$PARSE_RESULT" | sed -n '3p')

if [[ "\$PARSE_STATUS" != "OK" ]]; then
  graceful_allow "JSON parse failed"
fi

# Only process Write and Edit tools
if [[ "\$TOOL_NAME" != "Write" && "\$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

if [[ -z "\$FILE_PATH" ]]; then
  graceful_allow "No file_path in input"
fi

# Resolve the file path
RESOLVED_PATH=\$(realpath -m "\$FILE_PATH" 2>/dev/null || echo "\$FILE_PATH")

# Allow if path is outside repo entirely
if [[ "\$RESOLVED_PATH" != "\${MAIN_REPO_PATH}/"* && "\$RESOLVED_PATH" != "\${MAIN_REPO_PATH}" ]]; then
  exit 0
fi

# Allow if path is inside a worktree
if [[ "\$RESOLVED_PATH" == "\${WORKTREES_DIR}/"* ]]; then
  exit 0
fi

# Check if any active worktrees exist
WORKTREE_COUNT=0
if [[ -d "\$WORKTREES_DIR" ]]; then
  WORKTREE_COUNT=\$(find "\$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
fi

# If worktrees exist, block writes to main repo (original behavior)
if [[ "\$WORKTREE_COUNT" -gt 0 ]]; then
  ACTIVE_WORKTREES=\$(find "\$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null | head -5 | tr '\\n' ', ' | sed 's/,\$//')

  echo "" >&2
  echo "=== Worktree Enforcement ===" >&2
  echo "" >&2
  echo "BLOCKED: \$TOOL_NAME to main repo" >&2
  echo "" >&2
  echo "Active worktrees: \${ACTIVE_WORKTREES:-none detected}" >&2
  echo "" >&2
  echo "USE INSTEAD:" >&2
  echo "  1. cd to your worktree: cd worktrees/<lane>-wu-<id>/" >&2
  echo "  2. Make your edits in the worktree" >&2
  echo "" >&2
  echo "See: LUMENFLOW.md for worktree discipline" >&2
  echo "==============================" >&2
  exit 2
fi

# WU-1501: Fail-closed on main when no active worktrees exist
# Check allowlist: paths that are always safe to write on main
RELATIVE_PATH="\${RESOLVED_PATH#\${MAIN_REPO_PATH}/}"

case "\$RELATIVE_PATH" in
  docs/04-operations/tasks/wu/*)  exit 0 ;;  # WU YAML specs
  .lumenflow/*)                   exit 0 ;;  # LumenFlow state/config
  .claude/*)                      exit 0 ;;  # Claude Code config
  plan/*)                         exit 0 ;;  # Plan/spec scaffolds
esac

# Check for branch-pr claimed_mode (allows main writes without worktree)
STATE_FILE="\${LUMENFLOW_DIR}/state/wu-events.jsonl"
if [[ -f "\$STATE_FILE" ]]; then
  if grep -q '"claimed_mode":"branch-pr"' "\$STATE_FILE" 2>/dev/null; then
    if grep -q '"status":"in_progress"' "\$STATE_FILE" 2>/dev/null; then
      exit 0  # Branch-PR WU active - allow main writes
    fi
  fi
fi

# WU-1501: Fail-closed - no active claim context, block the write
echo "" >&2
echo "=== Worktree Enforcement ===" >&2
echo "" >&2
echo "BLOCKED: \$TOOL_NAME on main (no active WU claim)" >&2
echo "" >&2
echo "No worktrees exist and no branch-pr WU is in progress." >&2
echo "" >&2
echo "WHAT TO DO:" >&2
echo "  1. Claim a WU: pnpm wu:claim --id WU-XXXX --lane \\"<Lane>\\"" >&2
echo "  2. cd worktrees/<lane>-wu-xxxx" >&2
echo "  3. Make your edits in the worktree" >&2
echo "" >&2
echo "See: LUMENFLOW.md for worktree discipline" >&2
echo "==============================" >&2
exit 2
`;
  /* eslint-enable no-useless-escape */
}
