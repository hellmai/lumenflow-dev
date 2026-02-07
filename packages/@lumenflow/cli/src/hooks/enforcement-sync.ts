/**
 * @file enforcement-sync.ts
 * Sync enforcement hooks based on LumenFlow configuration (WU-1367)
 *
 * This module handles syncing Claude Code hooks during setup when
 * enforcement.hooks=true in the configuration.
 */

// fs operations use runtime-provided paths from LumenFlow configuration

// Object injection sink warnings are false positives for array indexing

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import {
  generateEnforcementHooks,
  generateEnforceWorktreeScript,
  generateRequireWuScript,
  generateWarnIncompleteScript,
  generateWarnDirtyMainScript,
  generatePreCompactCheckpointScript,
  generateSessionStartRecoveryScript,
  generateAutoCheckpointScript,
  HOOK_SCRIPTS,
  type GeneratedHooks,
} from './enforcement-generator.js';
import { checkAutoCheckpointWarning } from './auto-checkpoint-utils.js';

/**
 * Hook entry structure for Claude Code settings.json
 */
interface HookEntry {
  matcher: string;
  hooks: Array<{
    type: string;
    command: string;
  }>;
}

/**
 * Claude Code settings.json structure
 */
interface ClaudeSettings {
  $schema?: string;
  permissions?: {
    allow?: string[];
    deny?: string[];
    disableBypassPermissionsMode?: string;
  };
  hooks?: {
    PreToolUse?: HookEntry[];
    PostToolUse?: HookEntry[];
    Stop?: HookEntry[];
    PreCompact?: HookEntry[];
    SessionStart?: HookEntry[];
    SubagentStop?: HookEntry[];
  };
}

/**
 * LumenFlow config structure (partial, for enforcement reading)
 */
interface LumenFlowConfig {
  agents?: {
    clients?: {
      'claude-code'?: {
        enforcement?: {
          hooks?: boolean;
          block_outside_worktree?: boolean;
          require_wu_for_edits?: boolean;
          warn_on_stop_without_wu_done?: boolean;
        };
      };
    };
  };
  /** WU-1471: Memory enforcement configuration */
  memory?: {
    enforcement?: {
      auto_checkpoint?: {
        enabled?: boolean;
        interval_tool_calls?: number;
      };
      require_checkpoint_for_done?: string;
    };
  };
}

/**
 * Read LumenFlow configuration from .lumenflow.config.yaml
 *
 * @param projectDir - Project directory
 * @returns Parsed configuration or null if not found
 */
function readLumenFlowConfig(projectDir: string): LumenFlowConfig | null {
  const configPath = path.join(projectDir, '.lumenflow.config.yaml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    return yaml.parse(content) as LumenFlowConfig;
  } catch {
    return null;
  }
}

/**
 * Get enforcement configuration from LumenFlow config
 *
 * @param config - LumenFlow configuration
 * @returns Enforcement config or null if not enabled
 */
function getEnforcementConfig(config: LumenFlowConfig | null): {
  hooks: boolean;
  block_outside_worktree: boolean;
  require_wu_for_edits: boolean;
  warn_on_stop_without_wu_done: boolean;
  /** WU-1471: Auto-checkpoint config from memory.enforcement */
  auto_checkpoint?: {
    enabled: boolean;
    interval_tool_calls: number;
  };
} | null {
  const enforcement = config?.agents?.clients?.['claude-code']?.enforcement;

  if (!enforcement || !enforcement.hooks) {
    return null;
  }

  // WU-1471: Extract auto-checkpoint config from memory.enforcement
  const memoryEnforcement = config?.memory?.enforcement;
  const autoCheckpoint = memoryEnforcement?.auto_checkpoint;

  return {
    hooks: enforcement.hooks ?? false,
    block_outside_worktree: enforcement.block_outside_worktree ?? false,
    require_wu_for_edits: enforcement.require_wu_for_edits ?? false,
    warn_on_stop_without_wu_done: enforcement.warn_on_stop_without_wu_done ?? false,
    auto_checkpoint: autoCheckpoint?.enabled
      ? {
          enabled: true,
          interval_tool_calls: autoCheckpoint.interval_tool_calls ?? 30,
        }
      : undefined,
  };
}

/**
 * Read existing Claude settings.json
 *
 * @param projectDir - Project directory
 * @returns Parsed settings or default structure
 */
function readClaudeSettings(projectDir: string): ClaudeSettings {
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    return {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      permissions: {
        allow: ['Bash', 'Read', 'Write', 'Edit'],
      },
    };
  }

  try {
    const content = fs.readFileSync(settingsPath, 'utf-8');
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    return {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
    };
  }
}

/**
 * Write Claude settings.json
 *
 * @param projectDir - Project directory
 * @param settings - Settings to write
 */
function writeClaudeSettings(projectDir: string, settings: ClaudeSettings): void {
  const claudeDir = path.join(projectDir, '.claude');
  const settingsPath = path.join(claudeDir, 'settings.json');

  if (!fs.existsSync(claudeDir)) {
    fs.mkdirSync(claudeDir, { recursive: true });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
}

/**
 * Write hook script to .claude/hooks/
 *
 * @param projectDir - Project directory
 * @param filename - Script filename
 * @param content - Script content
 */
function writeHookScript(projectDir: string, filename: string, content: string): void {
  const hooksDir = path.join(projectDir, '.claude', 'hooks');

  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  const scriptPath = path.join(hooksDir, filename);
  fs.writeFileSync(scriptPath, content, { mode: 0o755 });
}

/**
 * Merge generated hooks with existing hooks in settings
 *
 * @param existing - Existing settings
 * @param generated - Generated hooks
 * @returns Merged settings
 */
// Complexity is acceptable for hook merging logic - alternative would over-abstract
// eslint-disable-next-line sonarjs/cognitive-complexity
function mergeHooksIntoSettings(
  existing: ClaudeSettings,
  generated: GeneratedHooks,
): ClaudeSettings {
  const result = { ...existing };

  if (!result.hooks) {
    result.hooks = {};
  }

  // Merge PreToolUse hooks
  if (generated.preToolUse) {
    if (!result.hooks.PreToolUse) {
      result.hooks.PreToolUse = [];
    }

    for (const newHook of generated.preToolUse) {
      // Find existing entry with same matcher
      const existingIndex = result.hooks.PreToolUse.findIndex((h) => h.matcher === newHook.matcher);

      if (existingIndex >= 0) {
        // Merge hooks into existing entry, avoiding duplicates
        const existing = result.hooks.PreToolUse[existingIndex];
        for (const hook of newHook.hooks) {
          const isDuplicate = existing.hooks.some((h) => h.command === hook.command);
          if (!isDuplicate) {
            existing.hooks.push(hook);
          }
        }
      } else {
        result.hooks.PreToolUse.push(newHook);
      }
    }
  }

  // Merge Stop hooks
  if (generated.stop) {
    if (!result.hooks.Stop) {
      result.hooks.Stop = [];
    }

    for (const newHook of generated.stop) {
      const existingIndex = result.hooks.Stop.findIndex((h) => h.matcher === newHook.matcher);

      if (existingIndex >= 0) {
        const existing = result.hooks.Stop[existingIndex];
        for (const hook of newHook.hooks) {
          const isDuplicate = existing.hooks.some((h) => h.command === hook.command);
          if (!isDuplicate) {
            existing.hooks.push(hook);
          }
        }
      } else {
        result.hooks.Stop.push(newHook);
      }
    }
  }

  // Merge PreCompact hooks (WU-1394)
  if (generated.preCompact) {
    if (!result.hooks.PreCompact) {
      result.hooks.PreCompact = [];
    }

    for (const newHook of generated.preCompact) {
      const existingIndex = result.hooks.PreCompact.findIndex((h) => h.matcher === newHook.matcher);

      if (existingIndex >= 0) {
        const existing = result.hooks.PreCompact[existingIndex];
        for (const hook of newHook.hooks) {
          const isDuplicate = existing.hooks.some((h) => h.command === hook.command);
          if (!isDuplicate) {
            existing.hooks.push(hook);
          }
        }
      } else {
        result.hooks.PreCompact.push(newHook);
      }
    }
  }

  // Merge SessionStart hooks (WU-1394)
  if (generated.sessionStart) {
    if (!result.hooks.SessionStart) {
      result.hooks.SessionStart = [];
    }

    for (const newHook of generated.sessionStart) {
      const existingIndex = result.hooks.SessionStart.findIndex(
        (h) => h.matcher === newHook.matcher,
      );

      if (existingIndex >= 0) {
        const existing = result.hooks.SessionStart[existingIndex];
        for (const hook of newHook.hooks) {
          const isDuplicate = existing.hooks.some((h) => h.command === hook.command);
          if (!isDuplicate) {
            existing.hooks.push(hook);
          }
        }
      } else {
        result.hooks.SessionStart.push(newHook);
      }
    }
  }

  // WU-1471: Merge PostToolUse hooks (auto-checkpoint)
  if (generated.postToolUse) {
    if (!result.hooks.PostToolUse) {
      result.hooks.PostToolUse = [];
    }

    for (const newHook of generated.postToolUse) {
      const existingIndex = result.hooks.PostToolUse.findIndex(
        (h) => h.matcher === newHook.matcher,
      );

      if (existingIndex >= 0) {
        const existing = result.hooks.PostToolUse[existingIndex];
        for (const hook of newHook.hooks) {
          const isDuplicate = existing.hooks.some((h) => h.command === hook.command);
          if (!isDuplicate) {
            existing.hooks.push(hook);
          }
        }
      } else {
        result.hooks.PostToolUse.push(newHook);
      }
    }
  }

  // WU-1471: Merge SubagentStop hooks (auto-checkpoint on sub-agent finish)
  if (generated.subagentStop) {
    if (!result.hooks.SubagentStop) {
      result.hooks.SubagentStop = [];
    }

    for (const newHook of generated.subagentStop) {
      const existingIndex = result.hooks.SubagentStop.findIndex(
        (h) => h.matcher === newHook.matcher,
      );

      if (existingIndex >= 0) {
        const existing = result.hooks.SubagentStop[existingIndex];
        for (const hook of newHook.hooks) {
          const isDuplicate = existing.hooks.some((h) => h.command === hook.command);
          if (!isDuplicate) {
            existing.hooks.push(hook);
          }
        }
      } else {
        result.hooks.SubagentStop.push(newHook);
      }
    }
  }

  return result;
}

/**
 * Sync enforcement hooks based on LumenFlow configuration.
 *
 * This function:
 * 1. Reads .lumenflow.config.yaml
 * 2. Checks if enforcement.hooks=true for claude-code
 * 3. Generates and writes hook scripts
 * 4. Updates .claude/settings.json with hook configuration
 *
 * @param projectDir - Project directory
 * @returns True if hooks were synced, false if skipped
 */
export async function syncEnforcementHooks(projectDir: string): Promise<boolean> {
  // Read LumenFlow config
  const config = readLumenFlowConfig(projectDir);
  const enforcement = getEnforcementConfig(config);

  // Skip if enforcement not enabled
  if (!enforcement || !enforcement.hooks) {
    return false;
  }

  // WU-1471: Check for auto-checkpoint mismatch warning (AC5)
  // Also check memory config independently for the case where hooks=true but
  // auto_checkpoint config comes from memory.enforcement section
  const memoryEnforcement = config?.memory?.enforcement;
  const autoCheckpointEnabled = memoryEnforcement?.auto_checkpoint?.enabled ?? false;

  const warningResult = checkAutoCheckpointWarning({
    hooksEnabled: enforcement.hooks,
    autoCheckpointEnabled,
  });
  if (warningResult.warning && warningResult.message) {
    console.warn(`[enforcement-sync] ${warningResult.message}`);
  }

  // Generate hooks based on config
  const generatedHooks = generateEnforcementHooks({
    block_outside_worktree: enforcement.block_outside_worktree,
    require_wu_for_edits: enforcement.require_wu_for_edits,
    warn_on_stop_without_wu_done: enforcement.warn_on_stop_without_wu_done,
    auto_checkpoint: enforcement.auto_checkpoint,
  });

  // Write hook scripts
  if (enforcement.block_outside_worktree) {
    writeHookScript(projectDir, HOOK_SCRIPTS.ENFORCE_WORKTREE, generateEnforceWorktreeScript());
  }

  if (enforcement.require_wu_for_edits) {
    writeHookScript(projectDir, HOOK_SCRIPTS.REQUIRE_WU, generateRequireWuScript());
  }

  if (enforcement.warn_on_stop_without_wu_done) {
    writeHookScript(projectDir, HOOK_SCRIPTS.WARN_INCOMPLETE, generateWarnIncompleteScript());
  }

  // WU-1471: Write auto-checkpoint hook script when enabled
  if (enforcement.auto_checkpoint?.enabled) {
    writeHookScript(
      projectDir,
      HOOK_SCRIPTS.AUTO_CHECKPOINT,
      generateAutoCheckpointScript(enforcement.auto_checkpoint.interval_tool_calls),
    );
  }

  // WU-1502: Always write dirty-main warning hook when enforcement.hooks is enabled
  // Detects file modifications on main after Bash commands
  writeHookScript(projectDir, HOOK_SCRIPTS.WARN_DIRTY_MAIN, generateWarnDirtyMainScript());

  // Always write recovery hook scripts when enforcement.hooks is enabled (WU-1394)
  // These enable durable context recovery after compaction
  writeHookScript(
    projectDir,
    HOOK_SCRIPTS.PRE_COMPACT_CHECKPOINT,
    generatePreCompactCheckpointScript(),
  );
  writeHookScript(
    projectDir,
    HOOK_SCRIPTS.SESSION_START_RECOVERY,
    generateSessionStartRecoveryScript(),
  );

  // Update settings.json
  const existingSettings = readClaudeSettings(projectDir);
  const updatedSettings = mergeHooksIntoSettings(existingSettings, generatedHooks);
  writeClaudeSettings(projectDir, updatedSettings);

  return true;
}

/**
 * Remove enforcement hooks from settings.json
 *
 * @param projectDir - Project directory
 */
export async function removeEnforcementHooks(projectDir: string): Promise<void> {
  const settings = readClaudeSettings(projectDir);

  if (!settings.hooks) {
    return;
  }

  // Remove enforcement-related hooks (includes all LumenFlow hook scripts)
  const enforcementCommands = Object.values(HOOK_SCRIPTS);

  if (settings.hooks.PreToolUse) {
    settings.hooks.PreToolUse = settings.hooks.PreToolUse.map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((h) => !enforcementCommands.some((cmd) => h.command.includes(cmd))),
    })).filter((entry) => entry.hooks.length > 0);

    if (settings.hooks.PreToolUse.length === 0) {
      delete settings.hooks.PreToolUse;
    }
  }

  if (settings.hooks.Stop) {
    settings.hooks.Stop = settings.hooks.Stop.map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((h) => !enforcementCommands.some((cmd) => h.command.includes(cmd))),
    })).filter((entry) => entry.hooks.length > 0);

    if (settings.hooks.Stop.length === 0) {
      delete settings.hooks.Stop;
    }
  }

  // WU-1471: Remove PostToolUse hooks
  if (settings.hooks.PostToolUse) {
    settings.hooks.PostToolUse = settings.hooks.PostToolUse.map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((h) => !enforcementCommands.some((cmd) => h.command.includes(cmd))),
    })).filter((entry) => entry.hooks.length > 0);

    if (settings.hooks.PostToolUse.length === 0) {
      delete settings.hooks.PostToolUse;
    }
  }

  // WU-1471: Remove SubagentStop hooks
  if (settings.hooks.SubagentStop) {
    settings.hooks.SubagentStop = settings.hooks.SubagentStop.map((entry) => ({
      ...entry,
      hooks: entry.hooks.filter((h) => !enforcementCommands.some((cmd) => h.command.includes(cmd))),
    })).filter((entry) => entry.hooks.length > 0);

    if (settings.hooks.SubagentStop.length === 0) {
      delete settings.hooks.SubagentStop;
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeClaudeSettings(projectDir, settings);
}
