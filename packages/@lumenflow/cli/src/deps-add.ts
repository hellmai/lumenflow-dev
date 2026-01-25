#!/usr/bin/env node
/**
 * Deps Add CLI Command
 *
 * Safe wrapper for `pnpm add` that enforces worktree discipline.
 * Dependencies can only be added from within a worktree, not from main checkout.
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 *
 * Usage:
 *   pnpm deps:add react
 *   pnpm deps:add --dev vitest
 *   pnpm deps:add --filter @lumenflow/cli chalk
 *
 * @see dependency-guard.ts for blocking logic
 */

import { execSync } from 'node:child_process';
import {
  STDIO_MODES,
  EXIT_CODES,
  PKG_MANAGER,
  DEFAULTS,
} from '@lumenflow/core/dist/wu-constants.js';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[deps:add]';

/**
 * Arguments for deps-add command
 */
export interface DepsAddArgs {
  /** Package names to add */
  packages?: string[];
  /** Add as dev dependency */
  dev?: boolean;
  /** Filter to specific workspace package */
  filter?: string;
  /** Use exact version */
  exact?: boolean;
  /** Show help */
  help?: boolean;
}

/**
 * Arguments for deps-remove command (also exported from here for convenience)
 */
export interface DepsRemoveArgs {
  /** Package names to remove */
  packages?: string[];
  /** Filter to specific workspace package */
  filter?: string;
  /** Show help */
  help?: boolean;
}

/**
 * Result of worktree context validation
 */
export interface WorktreeValidationResult {
  /** Whether the context is valid (inside worktree) */
  valid: boolean;
  /** Error message if invalid */
  error?: string;
  /** Fix command suggestion */
  fixCommand?: string;
}

/**
 * Parse command line arguments for deps-add
 *
 * @param argv - Process argv array
 * @returns Parsed arguments
 */
export function parseDepsAddArgs(argv: string[]): DepsAddArgs {
  const args: DepsAddArgs = {
    packages: [],
  };

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--dev' || arg === '-D') {
      args.dev = true;
    } else if (arg === '--exact' || arg === '-E') {
      args.exact = true;
    } else if (arg === '--filter' || arg === '-F') {
      args.filter = cliArgs[++i];
    } else if (!arg.startsWith('-')) {
      // Positional argument - package name
      args.packages!.push(arg);
    }
  }

  return args;
}

/**
 * Parse command line arguments for deps-remove
 *
 * @param argv - Process argv array
 * @returns Parsed arguments
 */
export function parseDepsRemoveArgs(argv: string[]): DepsRemoveArgs {
  const args: DepsRemoveArgs = {
    packages: [],
  };

  // Skip node and script name
  const cliArgs = argv.slice(2);

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--filter' || arg === '-F') {
      args.filter = cliArgs[++i];
    } else if (!arg.startsWith('-')) {
      // Positional argument - package name
      args.packages!.push(arg);
    }
  }

  return args;
}

/**
 * Validate that the current directory is within a worktree
 *
 * Dependencies should only be modified in worktrees to maintain
 * isolation and prevent lockfile conflicts on main checkout.
 *
 * @param cwd - Current working directory to validate
 * @returns Validation result with error and fix command if invalid
 */
export function validateWorktreeContext(cwd: string): WorktreeValidationResult {
  const worktreesDir = `/${DEFAULTS.WORKTREES_DIR}/`;

  if (cwd.includes(worktreesDir)) {
    return { valid: true };
  }

  return {
    valid: false,
    error: `Cannot modify dependencies on main checkout.\n\nReason: Running pnpm add/remove on main bypasses worktree isolation.\nThis can cause lockfile conflicts and block other agents.`,
    fixCommand: `1. Claim a WU: pnpm wu:claim --id WU-XXXX --lane "Your Lane"\n2. cd worktrees/<lane>-wu-<id>/\n3. Run deps:add from the worktree`,
  };
}

/**
 * Build pnpm add command string from arguments
 *
 * @param args - Parsed deps-add arguments
 * @returns Command string ready for execution
 */
export function buildPnpmAddCommand(args: DepsAddArgs): string {
  const parts: string[] = [PKG_MANAGER, 'add'];

  if (args.filter) {
    parts.push('--filter', args.filter);
  }

  if (args.dev) {
    parts.push('--save-dev');
  }

  if (args.exact) {
    parts.push('--save-exact');
  }

  if (args.packages && args.packages.length > 0) {
    parts.push(...args.packages);
  }

  return parts.join(' ');
}

/**
 * Build pnpm remove command string from arguments
 *
 * @param args - Parsed deps-remove arguments
 * @returns Command string ready for execution
 */
export function buildPnpmRemoveCommand(args: DepsRemoveArgs): string {
  const parts: string[] = [PKG_MANAGER, 'remove'];

  if (args.filter) {
    parts.push('--filter', args.filter);
  }

  if (args.packages && args.packages.length > 0) {
    parts.push(...args.packages);
  }

  return parts.join(' ');
}

/**
 * Print help message for deps-add
 */
/* istanbul ignore next -- CLI entry point */
function printHelp(): void {
  console.log(`
Usage: deps-add <packages...> [options]

Add dependencies with worktree discipline enforcement.
Must be run from inside a worktree (not main checkout).

Arguments:
  packages              Package names to add (e.g., react react-dom)

Options:
  -D, --dev             Add as dev dependency
  -F, --filter <pkg>    Filter to specific workspace package
  -E, --exact           Use exact version (--save-exact)
  -h, --help            Show this help message

Examples:
  deps-add react                    # Add react to root
  deps-add --dev vitest             # Add vitest as dev dependency
  deps-add -F @lumenflow/cli chalk  # Add chalk to @lumenflow/cli
  deps-add --exact react@18.2.0     # Add exact version

Worktree Discipline:
  This command only works inside a worktree to prevent lockfile
  conflicts on main checkout. Claim a WU first:

    pnpm wu:claim --id WU-XXXX --lane "Your Lane"
    cd worktrees/<lane>-wu-<id>/
    deps-add <package>
`);
}

/**
 * Main entry point for deps-add command
 */
/* istanbul ignore next -- CLI entry point */
async function main(): Promise<void> {
  const args = parseDepsAddArgs(process.argv);

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

  // Build and execute pnpm add command
  const command = buildPnpmAddCommand(args);
  console.log(`${LOG_PREFIX} Running: ${command}`);

  try {
    execSync(command, {
      stdio: STDIO_MODES.INHERIT,
      cwd: process.cwd(),
    });
    console.log(`${LOG_PREFIX} ✅ Dependencies added successfully`);
  } catch (error) {
    console.error(`${LOG_PREFIX} ❌ Failed to add dependencies`);
    process.exit(EXIT_CODES.ERROR);
  }
}

// Run main if executed directly
if (import.meta.main) {
  runCLI(main);
}
