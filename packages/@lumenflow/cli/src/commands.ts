/**
 * @file commands.ts
 * LumenFlow CLI commands discovery feature (WU-1378)
 * Updated to derive from public-manifest.ts (WU-1432)
 *
 * Provides a way to discover all available CLI commands grouped by category.
 * This helps agents and users find CLI workflows without reading docs.
 *
 * The command registry is now derived from the public manifest to ensure
 * a single source of truth for public commands.
 */

import { createWUParser } from '@lumenflow/core';
import { runCLI } from './cli-entry-point.js';
import {
  getCommandsByCategory,
  COMMAND_CATEGORIES,
  type PublicCommand,
} from './public-manifest.js';

/**
 * Individual command entry
 */
export interface CommandEntry {
  /** Command name as used with pnpm (e.g., 'wu:create') */
  name: string;
  /** Brief description of what the command does */
  description: string;
}

/**
 * Category grouping related commands
 */
export interface CommandCategory {
  /** Category name (e.g., 'WU Lifecycle') */
  name: string;
  /** Commands in this category */
  commands: CommandEntry[];
}

/**
 * Commands that are pnpm scripts, not CLI binaries
 * These are included in the discovery output but not in the public manifest
 */
const SCRIPT_COMMANDS: CommandCategory[] = [
  {
    name: 'Gates & Quality',
    commands: [
      { name: 'format', description: 'Format all files (Prettier)' },
      { name: 'lint', description: 'Run ESLint' },
      { name: 'typecheck', description: 'Run TypeScript type checking' },
      { name: 'test', description: 'Run all tests (Vitest)' },
    ],
  },
  {
    name: 'Setup & Development',
    commands: [{ name: 'setup', description: 'Install deps and build CLI (first time)' }],
  },
];

/**
 * Build the command registry from the public manifest
 * Merges manifest commands with script commands for complete discovery
 */
function buildCommandRegistry(): CommandCategory[] {
  const manifestByCategory = getCommandsByCategory();
  const categories: CommandCategory[] = [];

  // Define category order for consistent output
  const categoryOrder = [
    COMMAND_CATEGORIES.WU_LIFECYCLE,
    COMMAND_CATEGORIES.WU_MAINTENANCE,
    COMMAND_CATEGORIES.GATES_QUALITY,
    COMMAND_CATEGORIES.MEMORY_SESSIONS,
    COMMAND_CATEGORIES.INITIATIVES,
    COMMAND_CATEGORIES.PLANS,
    COMMAND_CATEGORIES.ORCHESTRATION,
    COMMAND_CATEGORIES.SETUP_DEVELOPMENT,
    COMMAND_CATEGORIES.METRICS_FLOW,
    COMMAND_CATEGORIES.STATE_MANAGEMENT,
  ];

  // Build categories from manifest
  for (const categoryName of categoryOrder) {
    const manifestCommands = manifestByCategory.get(categoryName) || [];

    // Convert to CommandEntry format
    const commands: CommandEntry[] = manifestCommands.map((cmd: PublicCommand) => ({
      name: cmd.name,
      description: cmd.description,
    }));

    // Add script commands for certain categories
    const scriptCategory = SCRIPT_COMMANDS.find((sc) => sc.name === categoryName);
    if (scriptCategory) {
      commands.push(...scriptCategory.commands);
    }

    if (commands.length > 0) {
      categories.push({
        name: categoryName,
        commands,
      });
    }
  }

  return categories;
}

// Build registry once at module load
const COMMAND_REGISTRY = buildCommandRegistry();

/**
 * Get the complete commands registry
 * @returns Array of command categories with their commands
 */
export function getCommandsRegistry(): CommandCategory[] {
  return COMMAND_REGISTRY;
}

/**
 * Format commands output for terminal display
 * @returns Formatted string with all commands grouped by category
 */
export function formatCommandsOutput(): string {
  const lines: string[] = [];

  lines.push('LumenFlow CLI Commands');
  lines.push('======================');
  lines.push('');

  for (const category of COMMAND_REGISTRY) {
    lines.push(`## ${category.name}`);
    lines.push('');

    // Find the longest command name for alignment
    const maxNameLength = Math.max(...category.commands.map((cmd) => cmd.name.length));

    for (const cmd of category.commands) {
      const padding = ' '.repeat(maxNameLength - cmd.name.length + 2);
      lines.push(`  ${cmd.name}${padding}${cmd.description}`);
    }

    lines.push('');
  }

  lines.push('---');
  lines.push('Tip: Run `pnpm <command> --help` for detailed options.');
  lines.push('');

  return lines.join('\n');
}

/**
 * CLI option definitions for commands command
 */
const COMMANDS_OPTIONS = {
  json: {
    name: 'json',
    flags: '--json',
    description: 'Output commands as JSON',
  },
};

/**
 * Parse commands command options using createWUParser
 */
export function parseCommandsOptions(): {
  json: boolean;
} {
  const opts = createWUParser({
    name: 'lumenflow-commands',
    description: 'List all available LumenFlow CLI commands',
    options: Object.values(COMMANDS_OPTIONS),
  });

  return {
    json: opts.json ?? false,
  };
}

/**
 * Main function for the commands CLI
 */
export async function main(): Promise<void> {
  const opts = parseCommandsOptions();

  if (opts.json) {
    console.log(JSON.stringify(getCommandsRegistry(), null, 2));
  } else {
    console.log(formatCommandsOutput());
  }
}

// CLI entry point
// WU-1071: Use import.meta.main for proper CLI detection with pnpm symlinks
if (import.meta.main) {
  void runCLI(main);
}
