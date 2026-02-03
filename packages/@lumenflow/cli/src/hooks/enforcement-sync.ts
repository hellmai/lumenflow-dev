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
  type GeneratedHooks,
} from './enforcement-generator.js';

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
    PreToolUse?: Array<{
      matcher: string;
      hooks: Array<{
        type: string;
        command: string;
      }>;
    }>;
    Stop?: Array<{
      matcher: string;
      hooks: Array<{
        type: string;
        command: string;
      }>;
    }>;
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
} | null {
  const enforcement = config?.agents?.clients?.['claude-code']?.enforcement;

  if (!enforcement || !enforcement.hooks) {
    return null;
  }

  return {
    hooks: enforcement.hooks ?? false,
    block_outside_worktree: enforcement.block_outside_worktree ?? false,
    require_wu_for_edits: enforcement.require_wu_for_edits ?? false,
    warn_on_stop_without_wu_done: enforcement.warn_on_stop_without_wu_done ?? false,
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

  // Generate hooks based on config
  const generatedHooks = generateEnforcementHooks({
    block_outside_worktree: enforcement.block_outside_worktree,
    require_wu_for_edits: enforcement.require_wu_for_edits,
    warn_on_stop_without_wu_done: enforcement.warn_on_stop_without_wu_done,
  });

  // Write hook scripts
  if (enforcement.block_outside_worktree) {
    writeHookScript(projectDir, 'enforce-worktree.sh', generateEnforceWorktreeScript());
  }

  if (enforcement.require_wu_for_edits) {
    writeHookScript(projectDir, 'require-wu.sh', generateRequireWuScript());
  }

  if (enforcement.warn_on_stop_without_wu_done) {
    writeHookScript(projectDir, 'warn-incomplete.sh', generateWarnIncompleteScript());
  }

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

  // Remove enforcement-related hooks
  const enforcementCommands = ['enforce-worktree.sh', 'require-wu.sh', 'warn-incomplete.sh'];

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

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeClaudeSettings(projectDir, settings);
}
