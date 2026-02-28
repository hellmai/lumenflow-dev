// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file generators/require-wu.ts
 * Generate the require-wu.sh hook script content (WU-1367).
 *
 * Extracted from enforcement-generator.ts by WU-1645.
 */

/**
 * Generate the require-wu.sh hook script content.
 *
 * This hook blocks Write/Edit operations when no WU is claimed.
 * Implements graceful degradation: allows operations if LumenFlow
 * state cannot be determined.
 */
export function generateRequireWuScript(): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
#
# require-wu.sh (WU-1367)
#
# PreToolUse hook that blocks Write/Edit when no WU is claimed.
# Graceful degradation: allows operations if state cannot be determined.
#
# Exit codes:
#   0 = Allow operation
#   2 = Block operation (stderr shown to Claude as guidance)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

# Graceful degradation
graceful_allow() {
  local reason="\$1"
  exit 0
}

if [[ -z "\${CLAUDE_PROJECT_DIR:-}" ]]; then
  graceful_allow "CLAUDE_PROJECT_DIR not set"
fi

MAIN_REPO_PATH="\$CLAUDE_PROJECT_DIR"
WORKTREES_DIR="\${MAIN_REPO_PATH}/worktrees"
LUMENFLOW_DIR="\${MAIN_REPO_PATH}/.lumenflow"
STATE_FILE="\${LUMENFLOW_DIR}/state/wu-events.jsonl"

# Check if LumenFlow is configured
if [[ ! -d "\$LUMENFLOW_DIR" ]]; then
  graceful_allow "No .lumenflow directory"
fi

# Read JSON input
INPUT=\$(cat)
if [[ -z "\$INPUT" ]]; then
  graceful_allow "No input"
fi

# Parse JSON
TMPFILE=\$(mktemp)
echo "\$INPUT" > "\$TMPFILE"

PARSE_RESULT=\$(python3 -c "
import json
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
except:
    print('ERROR')
    print('')
    print('')
" 2>/dev/null || echo "ERROR")

rm -f "\$TMPFILE"

# Parse result
PARSE_STATUS=\$(echo "\$PARSE_RESULT" | head -1)
TOOL_NAME=\$(echo "\$PARSE_RESULT" | sed -n '2p')
FILE_PATH=\$(echo "\$PARSE_RESULT" | sed -n '3p')

if [[ "\$PARSE_STATUS" != "OK" ]]; then
  graceful_allow "JSON parse failed"
fi

# Only check Write and Edit
if [[ "\$TOOL_NAME" != "Write" && "\$TOOL_NAME" != "Edit" ]]; then
  exit 0
fi

if [[ -z "\$FILE_PATH" ]]; then
  graceful_allow "No file_path in input"
fi

# Canonicalize tool path before resolution (e.g., "~/" -> "$HOME/")
CANONICAL_PATH="\$FILE_PATH"
if [[ "\$CANONICAL_PATH" == "~" ]]; then
  if [[ -n "\${HOME:-}" ]]; then
    CANONICAL_PATH="\$HOME"
  fi
elif [[ "\$CANONICAL_PATH" == "~/"* || "\$CANONICAL_PATH" == "~\\\\"* ]]; then
  if [[ -n "\${HOME:-}" ]]; then
    CANONICAL_PATH="\${HOME}/\${CANONICAL_PATH:2}"
  fi
fi

# Resolve the canonicalized file path
RESOLVED_PATH=\$(realpath -m "\$CANONICAL_PATH" 2>/dev/null || echo "\$CANONICAL_PATH")

# Only enforce WU requirement for writes targeting this repository
if [[ "\$RESOLVED_PATH" != "\${MAIN_REPO_PATH}/"* && "\$RESOLVED_PATH" != "\${MAIN_REPO_PATH}" ]]; then
  exit 0
fi

# Check for active worktrees (indicates claimed WU)
if [[ -d "\$WORKTREES_DIR" ]]; then
  WORKTREE_COUNT=\$(find "\$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  if [[ "\$WORKTREE_COUNT" -gt 0 ]]; then
    exit 0  # Has worktrees = has claimed WU
  fi
fi

# Check state file for in_progress WUs
if [[ -f "\$STATE_FILE" ]]; then
  # Look for UnsafeAny WU with in_progress status
  if grep -q '"status":"in_progress"' "\$STATE_FILE" 2>/dev/null; then
    exit 0  # Has in_progress WU
  fi
fi

# No claimed WU found
echo "" >&2
echo "=== WU Enforcement ===" >&2
echo "" >&2
echo "BLOCKED: \$TOOL_NAME without claimed WU" >&2
echo "" >&2
echo "You must claim a WU before making edits:" >&2
echo "  pnpm wu:claim --id WU-XXXX --lane <Lane>" >&2
echo "  cd worktrees/<lane>-wu-xxxx" >&2
echo "" >&2
echo "Or create a new WU:" >&2
echo "  pnpm wu:create --lane <Lane> --title \"Description\"" >&2
echo "" >&2
echo "See: LUMENFLOW.md for workflow details" >&2
echo "======================" >&2
exit 2
`;
  /* eslint-enable no-useless-escape */
}
