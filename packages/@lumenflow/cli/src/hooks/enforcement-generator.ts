/**
 * @file enforcement-generator.ts
 * Generates Claude Code enforcement hooks based on configuration (WU-1367)
 *
 * This module generates hook configurations that can be written to
 * .claude/settings.json to enforce LumenFlow workflow compliance.
 */

import { CLAUDE_HOOKS, getHookCommand } from '@lumenflow/core';
import { loadSignals, markSignalsAsRead } from '@lumenflow/memory/dist/mem-signal-core.js';

// Re-export for backwards compatibility (WU-1394)
export const HOOK_SCRIPTS = CLAUDE_HOOKS.SCRIPTS;

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
  postToolUse?: HookEntry[];
  stop?: HookEntry[];
  preCompact?: HookEntry[];
  sessionStart?: HookEntry[];
  subagentStop?: HookEntry[];
}

/**
 * WU-1471: Auto-checkpoint configuration for enforcement hooks
 */
export interface AutoCheckpointHookConfig {
  enabled: boolean;
  interval_tool_calls: number;
}

/**
 * Enforcement configuration for hook generation
 */
export interface EnforcementConfig {
  block_outside_worktree: boolean;
  require_wu_for_edits: boolean;
  warn_on_stop_without_wu_done: boolean;
  /** WU-1471: Auto-checkpoint hook configuration */
  auto_checkpoint?: AutoCheckpointHookConfig;
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
        command: getHookCommand(HOOK_SCRIPTS.ENFORCE_WORKTREE),
      });
    }

    if (config.require_wu_for_edits) {
      writeEditHooks.push({
        type: 'command',
        command: getHookCommand(HOOK_SCRIPTS.REQUIRE_WU),
      });
    }

    if (writeEditHooks.length > 0) {
      preToolUseHooks.push({
        matcher: CLAUDE_HOOKS.MATCHERS.WRITE_EDIT,
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
        matcher: CLAUDE_HOOKS.MATCHERS.ALL,
        hooks: [
          {
            type: 'command',
            command: getHookCommand(HOOK_SCRIPTS.WARN_INCOMPLETE),
          },
        ],
      },
    ];
  }

  // WU-1471: Generate PostToolUse and SubagentStop hooks for auto-checkpoint
  const postToolUseHooks: HookEntry[] = [];

  if (config.auto_checkpoint?.enabled) {
    const autoCheckpointHook: HookDefinition = {
      type: 'command',
      command: getHookCommand(HOOK_SCRIPTS.AUTO_CHECKPOINT),
    };

    // PostToolUse: fires after every tool call, counter tracks interval
    postToolUseHooks.push({
      matcher: CLAUDE_HOOKS.MATCHERS.ALL,
      hooks: [autoCheckpointHook],
    });

    // SubagentStop: fires when a sub-agent finishes, always checkpoint
    hooks.subagentStop = [
      {
        matcher: CLAUDE_HOOKS.MATCHERS.SUBAGENT_STOP,
        hooks: [autoCheckpointHook],
      },
    ];
  }

  // WU-1502: Always add PostToolUse Bash dirty-main warning hook
  // Detects file modifications on main after Bash commands and emits a warning
  postToolUseHooks.push({
    matcher: CLAUDE_HOOKS.MATCHERS.BASH,
    hooks: [
      {
        type: 'command',
        command: getHookCommand(HOOK_SCRIPTS.WARN_DIRTY_MAIN),
      },
    ],
  });

  hooks.postToolUse = postToolUseHooks;

  // Always generate PreCompact and SessionStart recovery hooks (WU-1394)
  // These enable durable context recovery after compaction
  hooks.preCompact = [
    {
      matcher: CLAUDE_HOOKS.MATCHERS.ALL,
      hooks: [
        {
          type: 'command',
          command: getHookCommand(HOOK_SCRIPTS.PRE_COMPACT_CHECKPOINT),
        },
      ],
    },
  ];

  hooks.sessionStart = [
    {
      matcher: CLAUDE_HOOKS.MATCHERS.COMPACT,
      hooks: [
        {
          type: 'command',
          command: getHookCommand(HOOK_SCRIPTS.SESSION_START_RECOVERY),
        },
      ],
    },
    {
      matcher: CLAUDE_HOOKS.MATCHERS.RESUME,
      hooks: [
        {
          type: 'command',
          command: getHookCommand(HOOK_SCRIPTS.SESSION_START_RECOVERY),
        },
      ],
    },
    {
      matcher: CLAUDE_HOOKS.MATCHERS.CLEAR,
      hooks: [
        {
          type: 'command',
          command: getHookCommand(HOOK_SCRIPTS.SESSION_START_RECOVERY),
        },
      ],
    },
  ];

  return hooks;
}

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

/**
 * WU-1502: Generate the warn-dirty-main.sh hook script content.
 *
 * PostToolUse hook for the Bash tool that detects file modifications on main
 * checkout and emits a high-signal warning with changed paths.
 *
 * Design:
 * - No-op inside worktrees (only fires on main checkout)
 * - Uses `git status --porcelain` to detect dirty state
 * - Always exits 0 (warning only, never blocks Bash execution)
 * - Reads stdin JSON to confirm tool_name is "Bash"
 * - Clean working tree overhead target: <50ms
 *
 * This is a vendor-agnostic detector: the script is generated by the shared
 * enforcement generator and placed as a thin wrapper by vendor integrations.
 */
export function generateWarnDirtyMainScript(): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
#
# warn-dirty-main.sh (WU-1502)
#
# PostToolUse hook for the Bash tool.
# Detects file modifications on main checkout after Bash commands
# and emits a high-signal warning listing changed paths.
#
# No-op inside worktrees. Always exits 0 (warning only, never blocks).
# Clean working tree overhead: <50ms (single git status call).
#
# Performance: fast-path checks (worktree, branch) run before stdin
# reading to avoid Python overhead in the common no-op case.
#
# Exit codes:
#   0 = Always (warnings only, never blocks)
#

# Fail-open: errors must never block Bash execution
set +e

# Derive repo paths
if [[ -z "\\\${CLAUDE_PROJECT_DIR:-}" ]]; then
  exit 0
fi

REPO_PATH="\\\$CLAUDE_PROJECT_DIR"
WORKTREES_DIR="\\\${REPO_PATH}/worktrees"
LUMENFLOW_DIR="\\\${REPO_PATH}/.lumenflow"

# No-op if LumenFlow is not configured
if [[ ! -d "\\\$LUMENFLOW_DIR" ]]; then
  exit 0
fi

# Fast-path: no-op inside worktrees (avoids stdin/Python overhead)
CWD=\\\$(pwd 2>/dev/null || echo "")
if [[ "\\\$CWD" == "\\\${WORKTREES_DIR}/"* ]]; then
  # Drain stdin to prevent broken pipe
  cat > /dev/null 2>/dev/null || true
  exit 0
fi

# Fast-path: only warn on main branch (avoids stdin/Python overhead)
CURRENT_BRANCH=\\\$(git -C "\\\$REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
if [[ "\\\$CURRENT_BRANCH" != "main" ]]; then
  # Drain stdin to prevent broken pipe
  cat > /dev/null 2>/dev/null || true
  exit 0
fi

# Read JSON input from stdin (PostToolUse provides tool_name + tool_input)
INPUT=\\\$(cat 2>/dev/null || true)

# Verify this is a Bash tool call (defensive: matcher should already filter)
if [[ -n "\\\$INPUT" ]]; then
  TOOL_NAME=\\\$(echo "\\\$INPUT" | python3 -c "
import json, sys
try:
    data = json.load(sys.stdin)
    print(data.get('tool_name', ''))
except:
    print('')
" 2>/dev/null || echo "")

  if [[ "\\\$TOOL_NAME" != "Bash" ]]; then
    exit 0
  fi
fi

# Check for dirty working tree (modified/untracked files)
DIRTY_LINES=\\\$(git -C "\\\$REPO_PATH" status --porcelain --untracked-files=all 2>/dev/null || true)
if [[ -z "\\\$DIRTY_LINES" ]]; then
  exit 0
fi

# Emit warning with changed paths
echo "" >&2
echo "=== Dirty Main Warning (WU-1502) ===" >&2
echo "" >&2
echo "WARNING: Bash command modified files on main checkout." >&2
echo "" >&2
echo "Modified paths:" >&2
echo "\\\$DIRTY_LINES" | head -20 | sed 's/^/  /' >&2
LINE_COUNT=\\\$(echo "\\\$DIRTY_LINES" | wc -l | tr -d ' ')
if [[ \\\$LINE_COUNT -gt 20 ]]; then
  echo "  ... (\\\$LINE_COUNT total, showing first 20)" >&2
fi
echo "" >&2
echo "WHAT TO DO:" >&2
echo "  1. If intentional: claim a WU and move changes to a worktree" >&2
echo "     pnpm wu:claim --id WU-XXXX --lane \\"<Lane>\\"" >&2
echo "  2. If accidental: discard the changes" >&2
echo "     git checkout -- . && git clean -fd" >&2
echo "" >&2
echo "Main should stay clean. See: LUMENFLOW.md" >&2
echo "=======================================" >&2

exit 0
`;
  /* eslint-enable no-useless-escape */
}

/**
 * Generate the pre-compact-checkpoint.sh hook script content.
 *
 * This PreCompact hook saves a checkpoint and writes a durable recovery file
 * before context compaction. The recovery file survives compaction and is
 * read by session-start-recovery.sh on the next session start.
 *
 * Part of WU-1394: Durable recovery pattern for context preservation.
 */
export function generatePreCompactCheckpointScript(): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
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

SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"

# Derive repo paths from CLAUDE_PROJECT_DIR
if [[ -n "\${CLAUDE_PROJECT_DIR:-}" ]]; then
  REPO_PATH="\$CLAUDE_PROJECT_DIR"
else
  REPO_PATH=\$(git rev-parse --show-toplevel 2>/dev/null || echo "")
  if [[ -z "\$REPO_PATH" ]]; then
    exit 0
  fi
fi

# Read JSON input from stdin
INPUT=\$(cat)

# Parse trigger from hook input (defensive - default to "auto")
# PreCompact provides: { "trigger": "manual" | "auto" }
TRIGGER=\$(python3 -c "
import json
import sys
try:
    data = json.loads('''\$INPUT''')
    trigger = data.get('trigger', 'auto')
    print(trigger if trigger else 'auto')
except:
    print('auto')
" 2>/dev/null || echo "auto")

# Get WU ID from worktree context (wu:status --json)
# Location.worktreeWuId is set when in a worktree
WU_ID=\$(pnpm wu:status --json 2>/dev/null | python3 -c "
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

# Proceed with worktree-based recovery if we have a WU ID
if [[ -n "\$WU_ID" ]]; then
  # Save checkpoint with pre-compact trigger
  # Note: This may fail if CLI not built, but that's OK - recovery file is more important
  pnpm mem:checkpoint "Auto: pre-\${TRIGGER}-compaction" --wu "\$WU_ID" --trigger "pre-compact" --quiet 2>/dev/null || true

  # Write durable recovery marker (survives compaction)
  # This is the key mechanism - file persists and is read by session-start-recovery.sh
  RECOVERY_DIR="\${REPO_PATH}/.lumenflow/state"
  RECOVERY_FILE="\${RECOVERY_DIR}/recovery-pending-\${WU_ID}.md"

  mkdir -p "\$RECOVERY_DIR"

  # Generate recovery context using mem:recover
  # The --quiet flag outputs only the recovery context without headers
  pnpm mem:recover --wu "\$WU_ID" --quiet > "\$RECOVERY_FILE" 2>/dev/null || {
    # Fallback minimal recovery if mem:recover fails
    cat > "\$RECOVERY_FILE" << EOF
# POST-COMPACTION RECOVERY

You are resuming work after context compaction. Your previous context was lost.
**WU:** \${WU_ID}

## Next Action
Run \\\`pnpm wu:spawn --id \${WU_ID}\\\` to spawn a fresh agent with full context.
EOF
  }

  # Output brief warning to stderr (may be compacted away, but recovery file persists)
  echo "" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "⚠️  COMPACTION: Checkpoint saved for \${WU_ID}" >&2
  echo "Recovery context: \${RECOVERY_FILE}" >&2
  echo "Next: pnpm wu:spawn --id \${WU_ID}" >&2
  echo "═══════════════════════════════════════════════════════" >&2
else
  # WU-1473: Non-worktree orchestrator context recovery
  # When not in a worktree (e.g., orchestrator on main), surface unread inbox
  # so agents have coordination context after compaction
  echo "" >&2
  echo "═══════════════════════════════════════════════════════" >&2
  echo "⚠️  COMPACTION: No active WU detected (non-worktree context)" >&2
  echo "Surfacing recent coordination signals via mem:inbox..." >&2
  pnpm mem:inbox --since 1h --quiet 2>/dev/null >&2 || true
  echo "═══════════════════════════════════════════════════════" >&2
fi

# Always exit 0 - cannot block compaction
exit 0
`;
  /* eslint-enable no-useless-escape */
}

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

# WU-1505: Early warning for dirty main checkout at SessionStart.
# Informational only (never blocks), helps agents catch polluted main state
# before any work begins.
CWD=\$(pwd)
WORKTREES_DIR="\${REPO_PATH}/worktrees"
CURRENT_BRANCH=\$(git -C "\$REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")

# No-op in worktrees and non-main branches.
if [[ "\$CWD" != "\${WORKTREES_DIR}/"* ]] && [[ "\$CURRENT_BRANCH" == "main" ]]; then
  DIRTY_LINES=\$(git -C "\$REPO_PATH" status --porcelain --untracked-files=all 2>/dev/null || true)
  if [[ -n "\$DIRTY_LINES" ]]; then
    echo "" >&2
    echo "═══════════════════════════════════════════════════════" >&2
    echo "⚠️  DIRTY MAIN CHECKOUT DETECTED" >&2
    echo "═══════════════════════════════════════════════════════" >&2
    echo "" >&2
    echo "Uncommitted files in main checkout:" >&2
    echo "\$DIRTY_LINES" | head -20 | sed 's/^/  /' >&2
    if [[ \$(echo "\$DIRTY_LINES" | wc -l | tr -d ' ') -gt 20 ]]; then
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
  echo "Recommended: Run 'pnpm wu:spawn --id \$WU_ID' for fresh full context." >&2
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

/**
 * WU-1471: Generate the auto-checkpoint.sh hook script content.
 *
 * This hook is used by both PostToolUse and SubagentStop events.
 * It branches on the hook_event_name environment variable:
 * - PostToolUse: Increments a per-WU counter and checkpoints at interval
 * - SubagentStop: Always creates a checkpoint (sub-agent finished work)
 *
 * Uses a defensive subshell to background checkpoint writes so the hook
 * returns quickly and does not block the agent.
 *
 * @param intervalToolCalls - Number of tool calls between auto-checkpoints
 * @returns Shell script content
 */
/**
 * WU-1473: Lightweight signal shape for display purposes.
 * Mirrors the Signal interface from @lumenflow/memory without direct type import.
 */
export interface DisplaySignal {
  id: string;
  message: string;
  created_at: string;
  read: boolean;
  wu_id?: string;
  lane?: string;
}

/**
 * WU-1473: Result of surfacing unread signals for agent consumption.
 */
export interface UnreadSignalSummary {
  /** Number of unread signals found */
  count: number;
  /** The unread signals (up to a reasonable display limit) */
  signals: DisplaySignal[];
}

/**
 * WU-1473: Surface unread signals for agent consumption during claim/start.
 *
 * Loads all unread signals from the memory layer and returns them for display.
 * Implements fail-open: any error returns an empty result without throwing.
 *
 * @param baseDir - Project base directory
 * @returns Unread signal summary (never throws)
 */
export async function surfaceUnreadSignals(baseDir: string): Promise<UnreadSignalSummary> {
  try {
    const signals = await loadSignals(baseDir, { unreadOnly: true });
    return { count: signals.length, signals };
  } catch {
    // WU-1473 AC4: Fail-open - memory errors never block lifecycle commands
    return { count: 0, signals: [] };
  }
}

/**
 * WU-1473: Mark all signals for a completed WU as read using receipt-aware behavior.
 *
 * Loads signals scoped to the given WU ID and marks any unread ones as read
 * by appending receipts (WU-1472 pattern). Does not rewrite signals.jsonl.
 * Implements fail-open: any error returns zero count without throwing.
 *
 * @param baseDir - Project base directory
 * @param wuId - WU ID whose signals should be marked as read
 * @returns Result with count of signals marked (never throws)
 */
export async function markCompletedWUSignalsAsRead(
  baseDir: string,
  wuId: string,
): Promise<{ markedCount: number }> {
  try {
    const signals = await loadSignals(baseDir, { wuId, unreadOnly: true });
    if (signals.length === 0) {
      return { markedCount: 0 };
    }
    const signalIds = signals.map((sig) => sig.id);
    return await markSignalsAsRead(baseDir, signalIds);
  } catch {
    // WU-1473 AC4: Fail-open - memory errors never block lifecycle commands
    return { markedCount: 0 };
  }
}

export function generateAutoCheckpointScript(intervalToolCalls: number): string {
  // Note: Shell variable escapes (\$, \") are intentional for the generated bash script
  /* eslint-disable no-useless-escape */
  return `#!/bin/bash
#
# auto-checkpoint.sh (WU-1471)
#
# PostToolUse + SubagentStop hook for automatic checkpointing.
# Branches on hook_event_name to decide behavior:
# - PostToolUse: counter-based checkpoint at interval
# - SubagentStop: always checkpoint (sub-agent completed work)
#
# Checkpoint writes are backgrounded in a defensive subshell
# to avoid blocking the agent.
#
# Exit codes:
#   0 = Always (never blocks tool execution)
#

# Fail-open: any error allows the operation to continue
set +e

INTERVAL=${intervalToolCalls}

# Derive repo paths
if [[ -z "\\\${CLAUDE_PROJECT_DIR:-}" ]]; then
  exit 0
fi

REPO_PATH="\\\$CLAUDE_PROJECT_DIR"
LUMENFLOW_DIR="\\\${REPO_PATH}/.lumenflow"
COUNTERS_DIR="\\\${LUMENFLOW_DIR}/state/hook-counters"

# Check if LumenFlow is configured
if [[ ! -d "\\\$LUMENFLOW_DIR" ]]; then
  exit 0
fi

# Detect WU ID from worktree context
WU_ID=""
CWD=\\\$(pwd 2>/dev/null || echo "")
if [[ "\\\$CWD" == *"/worktrees/"* ]]; then
  # Extract WU ID from worktree path (e.g., worktrees/framework-cli-wu-1471)
  WORKTREE_NAME=\\\$(basename "\\\$CWD")
  WU_ID=\\\$(echo "\\\$WORKTREE_NAME" | grep -oiE 'wu-[0-9]+' | head -1 | tr '[:lower:]' '[:upper:]')
fi

if [[ -z "\\\$WU_ID" ]]; then
  exit 0
fi

# Determine hook event name (set by Claude Code runtime)
HOOK_EVENT="\\\${hook_event_name:-PostToolUse}"

# Branch on event type
case "\\\$HOOK_EVENT" in
  SubagentStop)
    # Always checkpoint when sub-agent stops
    (
      pnpm mem:checkpoint "Auto: sub-agent completed" --wu "\\\$WU_ID" --trigger "subagent-stop" --quiet 2>/dev/null || true
    ) &
    ;;
  *)
    # PostToolUse (default): counter-based checkpointing
    mkdir -p "\\\$COUNTERS_DIR" 2>/dev/null || true
    COUNTER_FILE="\\\${COUNTERS_DIR}/\\\${WU_ID}.json"

    # Read current count (default 0)
    COUNT=0
    if [[ -f "\\\$COUNTER_FILE" ]]; then
      COUNT=\\\$(python3 -c "
import json
try:
    with open('\\\$COUNTER_FILE', 'r') as f:
        data = json.load(f)
    print(data.get('count', 0))
except:
    print(0)
" 2>/dev/null || echo "0")
    fi

    # Increment counter
    COUNT=\\\$((COUNT + 1))

    # Check if we've reached the interval
    if [[ \\\$COUNT -ge \\\$INTERVAL ]]; then
      # Reset counter and checkpoint in background
      echo '{"count": 0}' > "\\\$COUNTER_FILE" 2>/dev/null || true
      (
        pnpm mem:checkpoint "Auto: \\\${COUNT} tool calls" --wu "\\\$WU_ID" --trigger "auto-interval" --quiet 2>/dev/null || true
      ) &
    else
      # Just update the counter
      echo "{\\\\\\"count\\\\\\": \\\$COUNT}" > "\\\$COUNTER_FILE" 2>/dev/null || true
    fi
    ;;
esac

exit 0
`;
  /* eslint-enable no-useless-escape */
}
