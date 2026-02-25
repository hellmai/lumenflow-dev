#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * @file integrate.ts
 * Integrate LumenFlow with Claude Code (WU-1367)
 *
 * This command generates enforcement hooks and updates Claude Code
 * configuration based on workspace.yaml software_delivery settings.
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
import {
  createWUParser,
  WU_OPTIONS,
  CLAUDE_HOOKS,
  DIRECTORIES,
  LUMENFLOW_CLIENT_IDS,
  WORKSPACE_CONFIG_FILE_NAME,
  WORKSPACE_V2_KEYS,
} from '@lumenflow/core';
import {
  generateEnforcementHooks,
  generateEnforceWorktreeScript,
  generateRequireWuScript,
  generateWarnIncompleteScript,
  type GeneratedHooks,
} from '../hooks/enforcement-generator.js';
import { runCLI } from '../cli-entry-point.js';

/**
 * Supported clients for integration (WU-2157)
 */
const SUPPORTED_CLIENTS = [
  LUMENFLOW_CLIENT_IDS.CLAUDE_CODE,
  LUMENFLOW_CLIENT_IDS.CURSOR,
  LUMENFLOW_CLIENT_IDS.CODEX_CLI,
] as const;

/**
 * CLI options for integrate command
 */
const INTEGRATE_OPTIONS = {
  client: {
    name: 'client',
    flags: '--client <type>',
    description: `Client type to integrate (${SUPPORTED_CLIENTS.join(', ')})`,
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

interface WorkspaceSoftwareDeliveryConfig {
  agents?: {
    clients?: Record<string, IntegrateClientConfig | undefined>;
  };
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
    client: opts.client ?? LUMENFLOW_CLIENT_IDS.CLAUDE_CODE,
    force: opts.force ?? false,
  };
}

/**
 * Read existing Claude settings.json
 */
function readClaudeSettings(projectDir: string): ClaudeSettings {
  const settingsPath = path.join(projectDir, DIRECTORIES.CLAUDE, 'settings.json');

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
): Promise<string[]> {
  const enforcement = config.enforcement;
  const created: string[] = [];

  // Skip if enforcement not enabled
  if (!enforcement?.hooks) {
    console.log('[integrate] Enforcement hooks not enabled, skipping');
    return created;
  }

  const hooksDir = path.join(projectDir, DIRECTORIES.CLAUDE_HOOKS);

  // Create directories
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
    console.log('[integrate] Created hooks directory');
  }

  // Generate hooks based on config
  const generatedHooks = generateEnforcementHooks({
    block_outside_worktree: enforcement.block_outside_worktree ?? false,
    require_wu_for_edits: enforcement.require_wu_for_edits ?? false,
    warn_on_stop_without_wu_done: enforcement.warn_on_stop_without_wu_done ?? false,
  });

  // Write hook scripts — each flag maps to a constant script name and generator
  if (enforcement.block_outside_worktree) {
    const scriptPath = path.join(hooksDir, CLAUDE_HOOKS.SCRIPTS.ENFORCE_WORKTREE);
    fs.writeFileSync(scriptPath, generateEnforceWorktreeScript({ projectRoot: projectDir }), {
      mode: 0o755,
    });
    console.log(`[integrate] Generated ${CLAUDE_HOOKS.SCRIPTS.ENFORCE_WORKTREE}`);
    created.push(path.join(DIRECTORIES.CLAUDE_HOOKS, CLAUDE_HOOKS.SCRIPTS.ENFORCE_WORKTREE));
  }

  if (enforcement.require_wu_for_edits) {
    const scriptPath = path.join(hooksDir, CLAUDE_HOOKS.SCRIPTS.REQUIRE_WU);
    fs.writeFileSync(scriptPath, generateRequireWuScript(), { mode: 0o755 });
    console.log(`[integrate] Generated ${CLAUDE_HOOKS.SCRIPTS.REQUIRE_WU}`);
    created.push(path.join(DIRECTORIES.CLAUDE_HOOKS, CLAUDE_HOOKS.SCRIPTS.REQUIRE_WU));
  }

  if (enforcement.warn_on_stop_without_wu_done) {
    const scriptPath = path.join(hooksDir, CLAUDE_HOOKS.SCRIPTS.WARN_INCOMPLETE);
    fs.writeFileSync(scriptPath, generateWarnIncompleteScript(), { mode: 0o755 });
    console.log(`[integrate] Generated ${CLAUDE_HOOKS.SCRIPTS.WARN_INCOMPLETE}`);
    created.push(path.join(DIRECTORIES.CLAUDE_HOOKS, CLAUDE_HOOKS.SCRIPTS.WARN_INCOMPLETE));
  }

  // Update settings.json
  const existingSettings = readClaudeSettings(projectDir);
  const updatedSettings = mergeHooksIntoSettings(existingSettings, generatedHooks);

  const settingsPath = path.join(projectDir, DIRECTORIES.CLAUDE, 'settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2) + '\n', 'utf-8');
  console.log('[integrate] Updated settings.json');

  return created;
}

/**
 * Read software_delivery config from workspace.yaml.
 */
function readWorkspaceSoftwareDeliveryConfig(
  projectDir: string,
): WorkspaceSoftwareDeliveryConfig | null {
  const configPath = path.join(projectDir, WORKSPACE_CONFIG_FILE_NAME);

  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const workspaceDoc = yaml.parse(content);
    if (!workspaceDoc || typeof workspaceDoc !== 'object') {
      return null;
    }

    const workspace = workspaceDoc as Record<string, unknown>;
    const softwareDelivery = workspace[WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY];
    if (!softwareDelivery || typeof softwareDelivery !== 'object') {
      return null;
    }

    return softwareDelivery as WorkspaceSoftwareDeliveryConfig;
  } catch {
    return null;
  }
}

function readEnforcementConfig(projectDir: string): IntegrateEnforcementConfig | null {
  const softwareDelivery = readWorkspaceSoftwareDeliveryConfig(projectDir);
  return softwareDelivery?.agents?.clients?.[LUMENFLOW_CLIENT_IDS.CLAUDE_CODE]?.enforcement ?? null;
}

/**
 * Recovery rules content for Cursor (WU-2157)
 *
 * Cursor uses `.cursor/rules/*.md` files as static rules injected into the system prompt.
 * Since Cursor has no lifecycle hooks, we use convention-based recovery: the rules instruct
 * the agent to check for recovery files on session start.
 */
const CURSOR_RECOVERY_RULES = `# LumenFlow Context Recovery

## On Session Start

When starting a new session or resuming work, always check for pending recovery context:

\`\`\`bash
# Check for recovery files
ls .lumenflow/state/recovery-pending-*.md 2>/dev/null
\`\`\`

If recovery files exist:

1. Read the recovery file contents — they contain your last checkpoint, acceptance criteria, and code paths
2. Run \`pnpm mem:recover --wu WU-XXX\` (replace WU-XXX with the WU ID from the filename) for the latest context
3. Continue working based on the recovery context

## Context Loss Prevention

Before any long operation that might lose context:

\`\`\`bash
pnpm mem:checkpoint "description of current progress" --wu WU-XXX
\`\`\`

## Recovery Command Reference

| Command                                     | Purpose                            |
| ------------------------------------------- | ---------------------------------- |
| \`pnpm mem:recover --wu WU-XXX\`              | Generate recovery context for a WU |
| \`pnpm wu:brief --id WU-XXX --client cursor\` | Generate full handoff prompt       |
| \`pnpm wu:status --id WU-XXX\`                | Check WU status and location       |
| \`pnpm mem:checkpoint\`                       | Save progress checkpoint           |
`;

/**
 * Recovery section for AGENTS.md (WU-2157)
 *
 * Codex reads AGENTS.md as its preamble. This section provides recovery instructions
 * that work for any agent client.
 */
const AGENTS_RECOVERY_SECTION = `
---

## Context Recovery (WU-2157)

If you are resuming work or have lost context, check for recovery files:

\`\`\`bash
# Check for pending recovery
ls .lumenflow/state/recovery-pending-*.md 2>/dev/null

# Generate fresh recovery context
pnpm mem:recover --wu WU-XXX

# Or generate a full handoff prompt
pnpm wu:brief --id WU-XXX --client codex-cli
\`\`\`

Recovery files contain your last checkpoint, acceptance criteria, code paths, and changed files.
Always save checkpoints before long operations: \`pnpm mem:checkpoint "progress note" --wu WU-XXX\`
`;

/**
 * Integrate Cursor with LumenFlow recovery rules (WU-2157).
 *
 * Creates .cursor/rules/lumenflow-recovery.md with instructions for
 * checking recovery files on session boundaries.
 *
 * @param projectDir - Project directory
 * @returns List of created file paths
 */
export function integrateCursor(projectDir: string): string[] {
  const created: string[] = [];
  const rulesDir = path.join(projectDir, '.cursor', 'rules');

  if (!fs.existsSync(rulesDir)) {
    fs.mkdirSync(rulesDir, { recursive: true });
    console.log('[integrate] Created .cursor/rules/ directory');
  }

  const recoveryRulesPath = path.join(rulesDir, 'lumenflow-recovery.md');
  fs.writeFileSync(recoveryRulesPath, CURSOR_RECOVERY_RULES, 'utf-8');
  console.log('[integrate] Generated .cursor/rules/lumenflow-recovery.md');
  created.push('.cursor/rules/lumenflow-recovery.md');

  return created;
}

/**
 * Integrate Codex CLI with LumenFlow recovery instructions (WU-2157).
 *
 * Appends a recovery section to AGENTS.md if not already present.
 *
 * @param projectDir - Project directory
 * @returns List of modified file paths
 */
export function integrateCodexCli(projectDir: string): string[] {
  const created: string[] = [];
  const agentsPath = path.join(projectDir, 'AGENTS.md');

  if (!fs.existsSync(agentsPath)) {
    console.log('[integrate] AGENTS.md not found, skipping Codex integration');
    return created;
  }

  const content = fs.readFileSync(agentsPath, 'utf-8');

  // Check if recovery section already exists
  if (content.includes('## Context Recovery (WU-2157)')) {
    console.log('[integrate] AGENTS.md already contains recovery section, skipping');
    return created;
  }

  fs.writeFileSync(agentsPath, content + AGENTS_RECOVERY_SECTION, 'utf-8');
  console.log('[integrate] Appended recovery section to AGENTS.md');
  created.push('AGENTS.md');

  return created;
}

/**
 * Main entry point for integrate command
 */
export async function main(): Promise<void> {
  const opts = parseIntegrateOptions();
  const projectDir = process.cwd();

  // WU-2157: Support multiple client types
  switch (opts.client) {
    case LUMENFLOW_CLIENT_IDS.CLAUDE_CODE: {
      const enforcement = readEnforcementConfig(projectDir);

      if (!enforcement) {
        console.log(
          `[integrate] No enforcement config found in ${WORKSPACE_CONFIG_FILE_NAME} ` +
            `${WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY}.agents.clients.${LUMENFLOW_CLIENT_IDS.CLAUDE_CODE}`,
        );
        console.log('[integrate] Add this to your workspace config to enable enforcement hooks:');
        console.log(`
${WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY}:
  agents:
    clients:
      ${LUMENFLOW_CLIENT_IDS.CLAUDE_CODE}:
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
      break;
    }

    case LUMENFLOW_CLIENT_IDS.CURSOR: {
      integrateCursor(projectDir);
      console.log('[integrate] Cursor integration complete');
      break;
    }

    case LUMENFLOW_CLIENT_IDS.CODEX_CLI: {
      integrateCodexCli(projectDir);
      console.log('[integrate] Codex CLI integration complete');
      break;
    }

    default:
      console.error(`[integrate] Unsupported client: ${opts.client}`);
      console.error(`[integrate] Supported clients: ${SUPPORTED_CLIENTS.join(', ')}`);
      process.exit(1);
  }
}

// Run if executed directly
// WU-1537: Use import.meta.main + runCLI for consistent EPIPE and error handling
if (import.meta.main) {
  void runCLI(main);
}
