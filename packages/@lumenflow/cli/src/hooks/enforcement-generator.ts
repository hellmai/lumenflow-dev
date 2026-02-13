/**
 * @file enforcement-generator.ts
 * Generates Claude Code enforcement hooks based on configuration (WU-1367)
 *
 * This module is the dispatcher/orchestrator entrypoint for hook generation.
 * Individual hook script builders live under ./generators/ (WU-1645).
 *
 * All public exports are preserved for backward compatibility.
 */

import { CLAUDE_HOOKS, getHookCommand } from '@lumenflow/core';

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

  if (postToolUseHooks.length > 0) {
    hooks.postToolUse = postToolUseHooks;
  }

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

// ── Re-exports from per-hook generator modules (WU-1645) ──
// These preserve the public contract so all existing import paths continue to work.

export { generateEnforceWorktreeScript } from './generators/enforce-worktree.js';
export { generateRequireWuScript } from './generators/require-wu.js';
export { generateWarnIncompleteScript } from './generators/warn-incomplete.js';
export { generatePreCompactCheckpointScript } from './generators/pre-compact-checkpoint.js';
export { generateSessionStartRecoveryScript } from './generators/session-start-recovery.js';
export { generateAutoCheckpointScript } from './generators/auto-checkpoint.js';
export {
  surfaceUnreadSignals,
  markCompletedWUSignalsAsRead,
  type DisplaySignal,
  type UnreadSignalSummary,
} from './generators/signal-utils.js';
