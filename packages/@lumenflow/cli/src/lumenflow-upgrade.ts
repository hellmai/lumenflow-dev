#!/usr/bin/env node
/**
 * LumenFlow Upgrade CLI Command
 *
 * Updates all @lumenflow/* packages to a specified version or latest.
 * Uses worktree pattern to ensure pnpm install runs in worktree, not main.
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * Key requirements (from WU acceptance criteria):
 * - Uses worktree pattern (install runs in worktree, not main)
 * - Checks all 7 @lumenflow/* packages (not just 4)
 *
 * Usage:
 *   pnpm lumenflow:upgrade --version 1.5.0
 *   pnpm lumenflow:upgrade --latest
 *   pnpm lumenflow:upgrade --latest --dry-run
 */

import { execSync } from 'node:child_process';
import {
  STDIO_MODES,
  EXIT_CODES,
  PKG_MANAGER,
  DEFAULTS,
} from '@lumenflow/core/dist/wu-constants.js';
import { runCLI } from './cli-entry-point.js';
import { validateWorktreeContext } from './deps-add.js';

/** Log prefix for console output */
const LOG_PREFIX = '[lumenflow:upgrade]';

/**
 * All @lumenflow/* packages that should be upgraded together
 *
 * WU-1112: Must include all 7 packages (not just 4 as before)
 * Kept in alphabetical order for consistency
 */
export const LUMENFLOW_PACKAGES = [
  '@lumenflow/agent',
  '@lumenflow/cli',
  '@lumenflow/core',
  '@lumenflow/initiatives',
  '@lumenflow/memory',
  '@lumenflow/metrics',
  '@lumenflow/shims',
] as const;

/**
 * Arguments for lumenflow-upgrade command
 */
export interface UpgradeArgs {
  /** Specific version to upgrade to (e.g., '1.5.0') */
  version?: string;
  /** Upgrade to latest version */
  latest?: boolean;
  /** Dry run - show commands without executing */
  dryRun?: boolean;
  /** Show help */
  help?: boolean;
}

/**
 * Result of building upgrade commands
 */
export interface UpgradeResult {
  /** The pnpm add command to run */
  addCommand: string;
  /** Version specifier used */
  versionSpec: string;
}

/**
 * Parse command line arguments for lumenflow-upgrade
 *
 * @param argv - Process argv array
 * @returns Parsed arguments
 */
export function parseUpgradeArgs(argv: string[]): UpgradeArgs {
  const args: UpgradeArgs = {};

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--version' || arg === '-v') {
      args.version = cliArgs[++i];
    } else if (arg === '--latest' || arg === '-l') {
      args.latest = true;
    } else if (arg === '--dry-run' || arg === '-n') {
      args.dryRun = true;
    }
  }

  return args;
}

/**
 * Build the upgrade commands based on arguments
 *
 * Creates pnpm add command for all @lumenflow/* packages.
 * Uses --save-dev since these are development dependencies.
 *
 * @param args - Parsed upgrade arguments
 * @returns Object containing the commands to run
 */
export function buildUpgradeCommands(args: UpgradeArgs): UpgradeResult {
  // Determine version specifier
  const versionSpec = args.latest ? 'latest' : args.version || 'latest';

  // Build package list with version
  const packages = LUMENFLOW_PACKAGES.map((pkg) => `${pkg}@${versionSpec}`);

  // Build pnpm add command
  const addCommand = `${PKG_MANAGER} add --save-dev ${packages.join(' ')}`;

  return {
    addCommand,
    versionSpec,
  };
}

/**
 * Print help message for lumenflow-upgrade
 */
/* istanbul ignore next -- CLI entry point */
function printHelp(): void {
  console.log(`
Usage: lumenflow-upgrade [options]

Upgrade all @lumenflow/* packages to a specified version.
Must be run from inside a worktree to enforce worktree discipline.

Options:
  -v, --version <ver>   Upgrade to specific version (e.g., 1.5.0)
  -l, --latest          Upgrade to latest version
  -n, --dry-run         Show commands without executing
  -h, --help            Show this help message

Packages upgraded (all 7):
${LUMENFLOW_PACKAGES.map((p) => `  - ${p}`).join('\n')}

Examples:
  lumenflow:upgrade --version 1.5.0    # Upgrade to specific version
  lumenflow:upgrade --latest           # Upgrade to latest
  lumenflow:upgrade --latest --dry-run # Preview upgrade commands

Worktree Discipline:
  This command only works inside a worktree to prevent lockfile
  conflicts on main checkout. Claim a WU first:

    pnpm wu:claim --id WU-XXXX --lane "Your Lane"
    cd worktrees/<lane>-wu-<id>/
    lumenflow:upgrade --latest
`);
}

/**
 * Main entry point for lumenflow-upgrade command
 */
/* istanbul ignore next -- CLI entry point */
async function main(): Promise<void> {
  const args = parseUpgradeArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Require either --version or --latest
  if (!args.version && !args.latest) {
    console.error(`${LOG_PREFIX} Error: Must specify --version <ver> or --latest`);
    printHelp();
    process.exit(EXIT_CODES.ERROR);
  }

  // Validate worktree context (WU-1112 requirement: must run in worktree)
  const validation = validateWorktreeContext(process.cwd());
  if (!validation.valid) {
    console.error(`${LOG_PREFIX} ${validation.error}`);
    console.error(`\nTo fix:\n${validation.fixCommand}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // Build upgrade commands
  const { addCommand, versionSpec } = buildUpgradeCommands(args);

  console.log(`${LOG_PREFIX} Upgrading @lumenflow/* packages to ${versionSpec}`);
  console.log(`${LOG_PREFIX} Packages: ${LUMENFLOW_PACKAGES.length} packages`);

  if (args.dryRun) {
    console.log(`\n${LOG_PREFIX} DRY RUN - Commands that would be executed:`);
    console.log(`  ${addCommand}`);
    console.log(`\n${LOG_PREFIX} No changes made.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Execute upgrade
  console.log(`${LOG_PREFIX} Running: ${addCommand}`);

  try {
    execSync(addCommand, {
      stdio: STDIO_MODES.INHERIT,
      cwd: process.cwd(),
    });
    console.log(`\n${LOG_PREFIX} ✅ Upgrade complete!`);
    console.log(`${LOG_PREFIX} Upgraded to ${versionSpec}`);
    console.log(`\n${LOG_PREFIX} Next steps:`);
    console.log(`  1. Run 'pnpm build' to rebuild with new versions`);
    console.log(`  2. Run 'pnpm gates' to verify everything works`);
    console.log(`  3. Commit the changes`);
  } catch (error) {
    console.error(`\n${LOG_PREFIX} ❌ Upgrade failed`);
    console.error(`${LOG_PREFIX} Check the error above and try again.`);
    process.exit(EXIT_CODES.ERROR);
  }
}

// Run main if executed directly
if (import.meta.main) {
  runCLI(main);
}
