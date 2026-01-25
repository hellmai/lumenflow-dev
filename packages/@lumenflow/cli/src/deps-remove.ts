#!/usr/bin/env node
/**
 * Deps Remove CLI Command
 *
 * Safe wrapper for `pnpm remove` that enforces worktree discipline.
 * Dependencies can only be removed from within a worktree, not from main checkout.
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * Usage:
 *   pnpm deps:remove lodash
 *   pnpm deps:remove --filter @lumenflow/cli chalk
 *
 * @see dependency-guard.ts for blocking logic
 */

import { execSync } from 'node:child_process';
import { STDIO_MODES, EXIT_CODES } from '@lumenflow/core/dist/wu-constants.js';
import { runCLI } from './cli-entry-point.js';
import {
  parseDepsRemoveArgs,
  validateWorktreeContext,
  buildPnpmRemoveCommand,
  type DepsRemoveArgs,
} from './deps-add.js';

/** Log prefix for console output */
const LOG_PREFIX = '[deps:remove]';

/**
 * Print help message for deps-remove
 */
/* istanbul ignore next -- CLI entry point */
function printHelp(): void {
  console.log(`
Usage: deps-remove <packages...> [options]

Remove dependencies with worktree discipline enforcement.
Must be run from inside a worktree (not main checkout).

Arguments:
  packages              Package names to remove (e.g., lodash moment)

Options:
  -F, --filter <pkg>    Filter to specific workspace package
  -h, --help            Show this help message

Examples:
  deps-remove lodash                    # Remove lodash from root
  deps-remove -F @lumenflow/cli chalk   # Remove chalk from @lumenflow/cli
  deps-remove lodash moment             # Remove multiple packages

Worktree Discipline:
  This command only works inside a worktree to prevent lockfile
  conflicts on main checkout. Claim a WU first:

    pnpm wu:claim --id WU-XXXX --lane "Your Lane"
    cd worktrees/<lane>-wu-<id>/
    deps-remove <package>
`);
}

/**
 * Main entry point for deps-remove command
 */
/* istanbul ignore next -- CLI entry point */
async function main(): Promise<void> {
  const args = parseDepsRemoveArgs(process.argv);

  if (args.help) {
    printHelp();
    process.exit(EXIT_CODES.SUCCESS);
  }

  if (!args.packages || args.packages.length === 0) {
    console.error(`${LOG_PREFIX} Error: No packages specified`);
    printHelp();
    process.exit(EXIT_CODES.ERROR);
  }

  // Validate worktree context
  const validation = validateWorktreeContext(process.cwd());
  if (!validation.valid) {
    console.error(`${LOG_PREFIX} ${validation.error}`);
    console.error(`\nTo fix:\n${validation.fixCommand}`);
    process.exit(EXIT_CODES.ERROR);
  }

  // Build and execute pnpm remove command
  const command = buildPnpmRemoveCommand(args);
  console.log(`${LOG_PREFIX} Running: ${command}`);

  try {
    execSync(command, {
      stdio: STDIO_MODES.INHERIT,
      cwd: process.cwd(),
    });
    console.log(`${LOG_PREFIX} ✅ Dependencies removed successfully`);
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Failed to remove dependencies`);
    process.exit(EXIT_CODES.ERROR);
  }
}

// Re-export types for convenience
export type { DepsRemoveArgs };

// Run main if executed directly
if (import.meta.main) {
  runCLI(main);
}
