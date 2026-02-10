/**
 * @file integrate.ts
 * Integrate LumenFlow with Claude Code (WU-1367)
 *
 * This command generates enforcement hooks and updates Claude Code
 * configuration based on .lumenflow.config.yaml settings.
 *
 * Usage:
 *   pnpm lumenflow:integrate --client claude-code
 */

// CLI tool - console output is intentional for user feedback

// fs operations use runtime-provided paths from LumenFlow configuration

// Object injection sink warnings are false positives for array indexing

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as yaml from 'yaml';
import { createWUParser, WU_OPTIONS } from '@lumenflow/core';
import {
  generateEnforcementHooks,
  generateEnforceWorktreeScript,
  generateRequireWuScript,
  generateWarnIncompleteScript,
  type GeneratedHooks,
} from '../hooks/enforcement-generator.js';
import { runCLI } from '../cli-entry-point.js';

/**
 * CLI options for integrate command
 */
const INTEGRATE_OPTIONS = {
  client: {
    name: 'client',
    flags: '--client <type>',
    description: 'Client type to integrate (claude-code)',
  },
  force: WU_OPTIONS.force,
};

/**
 * Enforcement configuration for integration
 */
export interface IntegrateEnforcementConfig {
  hooks?: boolean;
  block_outside_worktree?: boolean;
  require_wu_for_edits?: boolean;
  warn_on_stop_without_wu_done?: boolean;
}

/**
 * Client configuration for integration
 */
export interface IntegrateClientConfig {
  enforcement?: IntegrateEnforcementConfig;
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
 * Parse command line options
 */
export function parseIntegrateOptions(): {
  client: string;
  force: boolean;
} {
  const opts = createWUParser({
    name: 'lumenflow-integrate',
    description: 'Integrate LumenFlow enforcement with AI client tools',
    options: Object.values(INTEGRATE_OPTIONS),
  });

  return {
    client: opts.client ?? 'claude-code',
    force: opts.force ?? false,
  };
}

/**
 * Read existing Claude settings.json
 */
function readClaudeSettings(projectDir: string): ClaudeSettings {
  const settingsPath = path.join(projectDir, '.claude', 'settings.json');

  if (!fs.existsSync(settingsPath)) {
    return {
      $schema: 'https://json.schemastore.org/claude-code-settings.json',
      permissions: {
        allow: ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Skill'],
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
 * Merge generated hooks into existing settings
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
      const existingIndex = result.hooks.PreToolUse.findIndex((h) => h.matcher === newHook.matcher);

      if (existingIndex >= 0) {
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
 * Integrate Claude Code with LumenFlow enforcement hooks.
 *
 * This function:
 * 1. Creates .claude/hooks directory if needed
 * 2. Generates enforcement hook scripts
 * 3. Updates .claude/settings.json with hook configuration
 *
 * @param projectDir - Project directory
 * @param config - Client configuration with enforcement settings
 */
export async function integrateClaudeCode(
  projectDir: string,
  config: IntegrateClientConfig,
): Promise<void> {
  const enforcement = config.enforcement;

  // Skip if enforcement not enabled
  if (!enforcement?.hooks) {
    console.log('[integrate] Enforcement hooks not enabled, skipping');
    return;
  }

  const claudeDir = path.join(projectDir, '.claude');
  const hooksDir = path.join(claudeDir, 'hooks');

  // Create directories
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    console.log('[integrate] Created .claude/hooks directory');
  }

  // Generate hooks based on config
  const generatedHooks = generateEnforcementHooks({
    block_outside_worktree: enforcement.block_outside_worktree ?? false,
    require_wu_for_edits: enforcement.require_wu_for_edits ?? false,
    warn_on_stop_without_wu_done: enforcement.warn_on_stop_without_wu_done ?? false,
  });

  // Write hook scripts
  if (enforcement.block_outside_worktree) {
    const scriptPath = path.join(hooksDir, 'enforce-worktree.sh');
    fs.writeFileSync(scriptPath, generateEnforceWorktreeScript(), { mode: 0o755 });
    console.log('[integrate] Generated enforce-worktree.sh');
  }

  if (enforcement.require_wu_for_edits) {
    const scriptPath = path.join(hooksDir, 'require-wu.sh');
    fs.writeFileSync(scriptPath, generateRequireWuScript(), { mode: 0o755 });
    console.log('[integrate] Generated require-wu.sh');
  }

  if (enforcement.warn_on_stop_without_wu_done) {
    const scriptPath = path.join(hooksDir, 'warn-incomplete.sh');
    fs.writeFileSync(scriptPath, generateWarnIncompleteScript(), { mode: 0o755 });
    console.log('[integrate] Generated warn-incomplete.sh');
  }

  // Update settings.json
  const existingSettings = readClaudeSettings(projectDir);
  const updatedSettings = mergeHooksIntoSettings(existingSettings, generatedHooks);

  const settingsPath = path.join(claudeDir, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2) + '\n', 'utf-8');
  console.log('[integrate] Updated .claude/settings.json');
}

/**
 * Read enforcement config from .lumenflow.config.yaml
 */
function readEnforcementConfig(projectDir: string): IntegrateEnforcementConfig | null {
  const configPath = path.join(projectDir, '.lumenflow.config.yaml');

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = yaml.parse(content);
    return config?.agents?.clients?.['claude-code']?.enforcement ?? null;
  } catch {
    return null;
  }
}

/**
 * Main entry point for integrate command
 */
export async function main(): Promise<void> {
  const opts = parseIntegrateOptions();

  if (opts.client !== 'claude-code') {
    console.error(`[integrate] Unsupported client: ${opts.client}`);
    console.error('[integrate] Currently only "claude-code" is supported');
    process.exit(1);
  }

  const projectDir = process.cwd();

  // Read enforcement config from .lumenflow.config.yaml
  const enforcement = readEnforcementConfig(projectDir);

  if (!enforcement) {
    console.log('[integrate] No enforcement config found in .lumenflow.config.yaml');
    console.log('[integrate] Add this to your config to enable enforcement hooks:');
    console.log(`
agents:
  clients:
    claude-code:
      enforcement:
        hooks: true
        block_outside_worktree: true
        require_wu_for_edits: true
        warn_on_stop_without_wu_done: true
`);
    return;
  }

  await integrateClaudeCode(projectDir, { enforcement });
  console.log('[integrate] Claude Code integration complete');
}

// Run if executed directly
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
