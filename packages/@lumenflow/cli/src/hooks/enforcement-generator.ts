/**
 * @file enforcement-generator.ts
 * Generates Claude Code enforcement hooks based on configuration (WU-1367)
 *
 * This module generates hook configurations that can be written to
 * .claude/settings.json to enforce LumenFlow workflow compliance.
 */

/**
 * Hook definition for Claude Code settings.json
 */
export interface HookDefinition {
  type: 'command';
  command: string;
}

/**
 * Matcher-based hook entry for settings.json
 */
export interface HookEntry {
  matcher: string;
  hooks: HookDefinition[];
}

/**
 * Generated hooks structure
 */
export interface GeneratedHooks {
  preToolUse?: HookEntry[];
  stop?: HookEntry[];
}

/**
 * Enforcement configuration for hook generation
 */
export interface EnforcementConfig {
  block_outside_worktree: boolean;
  require_wu_for_edits: boolean;
  warn_on_stop_without_wu_done: boolean;
}

/**
 * Generate enforcement hooks based on configuration.
 *
 * @param config - Enforcement configuration
 * @returns Generated hooks structure for settings.json
 */
export function generateEnforcementHooks(config: EnforcementConfig): GeneratedHooks {
  const hooks: GeneratedHooks = {};
  const preToolUseHooks: HookEntry[] = [];

  // Generate PreToolUse hooks for Write/Edit operations
  if (config.block_outside_worktree || config.require_wu_for_edits) {
    const writeEditHooks: HookDefinition[] = [];

    if (config.block_outside_worktree) {
      writeEditHooks.push({
        type: 'command',
        command: '$CLAUDE_PROJECT_DIR/.claude/hooks/enforce-worktree.sh',
      });
    }

    if (config.require_wu_for_edits) {
      writeEditHooks.push({
        type: 'command',
        command: '$CLAUDE_PROJECT_DIR/.claude/hooks/require-wu.sh',
      });
    }

    if (writeEditHooks.length > 0) {
      preToolUseHooks.push({
        matcher: 'Write|Edit',
        hooks: writeEditHooks,
      });
    }
  }

  if (preToolUseHooks.length > 0) {
    hooks.preToolUse = preToolUseHooks;
  }

  // Generate Stop hook for session completion warning
  if (config.warn_on_stop_without_wu_done) {
    hooks.stop = [
      {
        matcher: '.*',
        hooks: [
          {
            type: 'command',
            command: '$CLAUDE_PROJECT_DIR/.claude/hooks/warn-incomplete.sh',
          },
        ],
      },
    ];
  }

  return hooks;
}

/**
 * Generate the enforce-worktree.sh hook script content.
 *
 * This hook blocks Write/Edit operations when not in a worktree.
 * Implements graceful degradation: allows operations if LumenFlow
 * state cannot be determined.
 */
export function generateEnforceWorktreeScript(): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
#
# enforce-worktree.sh (WU-1367)
#
# PreToolUse hook that blocks Write/Edit when not in a worktree.
# Graceful degradation: allows operations if state cannot be determined.
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
  # Optionally log for debugging
  # echo "[enforce-worktree] Graceful allow: \$reason" >&2
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

# Check if any worktrees exist
if [[ ! -d "\$WORKTREES_DIR" ]]; then
  exit 0  # No worktrees = no enforcement needed
fi

WORKTREE_COUNT=\$(find "\$WORKTREES_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
if [[ "\$WORKTREE_COUNT" -eq 0 ]]; then
  exit 0  # No active worktrees
fi

# Resolve the file path
RESOLVED_PATH=\$(realpath -m "\$FILE_PATH" 2>/dev/null || echo "\$FILE_PATH")

# Allow if path is inside a worktree
if [[ "\$RESOLVED_PATH" == "\${WORKTREES_DIR}/"* ]]; then
  exit 0
fi

# Block if path is in main repo while worktrees exist
if [[ "\$RESOLVED_PATH" == "\${MAIN_REPO_PATH}/"* || "\$RESOLVED_PATH" == "\${MAIN_REPO_PATH}" ]]; then
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

# Path is outside repo entirely - allow
exit 0
`;
  /* eslint-enable no-useless-escape */
}

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

TOOL_NAME=\$(python3 -c "
import json
try:
    with open('\$TMPFILE', 'r') as f:
        data = json.load(f)
    print(data.get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")

rm -f "\$TMPFILE"

# Only check Write and Edit
if [[ "\$TOOL_NAME" != "Write" && "\$TOOL_NAME" != "Edit" ]]; then
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
  # Look for any WU with in_progress status
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
