#!/usr/bin/env node
/**
 * LumenFlow Upgrade CLI Command
 *
 * Updates all @lumenflow/* packages to a specified version or latest.
 * Uses micro-worktree pattern for atomic changes to main without requiring
 * users to be in a worktree.
 *
 * WU-1112: INIT-003 Phase 6 - Migrate remaining Tier 1 tools
 * WU-1127: Use micro-worktree isolation pattern (fixes user blocking issue)
 *
 * Key requirements:
 * - Uses micro-worktree pattern (atomic changes, no user worktree needed)
 * - Runs from main checkout (not inside a worktree)
 * - Checks all 7 @lumenflow/* packages
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
  PKG_COMMANDS,
  PKG_FLAGS,
  DEFAULTS,
  BRANCHES,
} from '@lumenflow/core/wu-constants';
import { getGitForCwd } from '@lumenflow/core/git-adapter';
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[lumenflow:upgrade]';

/** Operation name for micro-worktree */
const OPERATION_NAME = 'lumenflow-upgrade';

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
 * Result of main checkout validation
 */
export interface MainCheckoutValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Error message if validation failed */
  error?: string;
  /** Suggested fix command */
  fixCommand?: string;
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

  // Build pnpm add command using array pattern (matches deps-add.ts convention)
  // WU-1527: -w required for pnpm monorepo workspace root installs
  const parts: string[] = [
    PKG_MANAGER,
    PKG_COMMANDS.ADD,
    PKG_FLAGS.SAVE_DEV,
    PKG_FLAGS.WORKSPACE_ROOT,
    ...packages,
  ];

  return {
    addCommand: parts.join(' '),
    versionSpec,
  };
}

/**
 * WU-1127: Validate that the command is run from main checkout
 *
 * The micro-worktree pattern requires the command to be run from the main
 * checkout (not inside a worktree). This is the inverse of the old behavior
 * which required users to be IN a worktree.
 *
 * @returns Validation result with error and fix command if invalid
 */
export async function validateMainCheckout(): Promise<MainCheckoutValidationResult> {
  const cwd = process.cwd();
  const worktreesDir = `/${DEFAULTS.WORKTREES_DIR}/`;

  // Check if we're inside a worktree directory
  if (cwd.includes(worktreesDir)) {
    return {
      valid: false,
      error:
        `Cannot run lumenflow:upgrade from inside a worktree.\n\n` +
        `This command must be run from main checkout because it uses\n` +
        `micro-worktree isolation to atomically update package.json and lockfile.`,
      fixCommand: `cd to main checkout and re-run:\n  cd <main-checkout>\n  pnpm lumenflow:upgrade --latest`,
    };
  }

  // Check if we're on main branch
  try {
    const git = getGitForCwd();
    const currentBranch = await git.raw(['rev-parse', '--abbrev-ref', 'HEAD']);
    const branchName = currentBranch.trim();

    if (branchName !== BRANCHES.MAIN) {
      return {
        valid: false,
        error:
          `lumenflow:upgrade must be run from main checkout (on main branch).\n\n` +
          `Current branch: ${branchName}\n` +
          `Expected branch: main`,
        fixCommand: `Switch to main branch:\n  git checkout main\n  pnpm lumenflow:upgrade --latest`,
      };
    }
  } catch (error) {
    // If git fails, assume we're not in a valid git repo
    return {
      valid: false,
      error: `Failed to detect git branch. Ensure you're in a git repository.`,
    };
  }

  return { valid: true };
}

/**
 * WU-1127: Execute the upgrade in a micro-worktree
 *
 * Uses the shared micro-worktree pattern (like wu:create, wu:edit) to:
 * 1. Create a temporary worktree without switching main checkout
 * 2. Run pnpm add in the temporary worktree
 * 3. Commit the changes
 * 4. FF-only merge to main
 * 5. Push to origin
 * 6. Cleanup
 *
 * @param args - Parsed upgrade arguments
 * @returns Promise resolving when upgrade is complete
 */
export async function executeUpgradeInMicroWorktree(args: UpgradeArgs): Promise<void> {
  const { addCommand, versionSpec } = buildUpgradeCommands(args);

  // Generate unique ID for this upgrade operation using timestamp
  const upgradeId = `upgrade-${Date.now()}`;

  console.log(`${LOG_PREFIX} Using micro-worktree isolation (WU-1127)`);
  console.log(`${LOG_PREFIX} Upgrading @lumenflow/* packages to ${versionSpec}`);
  console.log(`${LOG_PREFIX} Packages: ${LUMENFLOW_PACKAGES.length} packages`);

  await withMicroWorktree({
    operation: OPERATION_NAME,
    id: upgradeId,
    logPrefix: LOG_PREFIX,
    execute: async ({ worktreePath }) => {
      console.log(`${LOG_PREFIX} Running: ${addCommand}`);

      // Execute pnpm add in the micro-worktree
      execSync(addCommand, {
        stdio: STDIO_MODES.INHERIT,
        cwd: worktreePath,
      });

      console.log(`${LOG_PREFIX} Package installation complete`);

      // Return files to stage and commit message
      return {
        commitMessage: `chore: upgrade @lumenflow packages to ${versionSpec}`,
        files: ['package.json', 'pnpm-lock.yaml'],
      };
    },
  });

  console.log(`\n${LOG_PREFIX} Upgrade complete!`);
  console.log(`${LOG_PREFIX} Upgraded to ${versionSpec}`);
  console.log(`\n${LOG_PREFIX} Next steps:`);
  console.log(`  1. Run 'pnpm build' to rebuild with new versions`);
  console.log(`  2. Run 'pnpm gates' to verify everything works`);
}

/**
 * Print help message for lumenflow-upgrade
 */
/* istanbul ignore next -- CLI entry point */
function printHelp(): void {
  console.log(`
Usage: lumenflow-upgrade [options]

Upgrade all @lumenflow/* packages to a specified version.
Uses micro-worktree isolation to atomically update packages from main checkout.

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

Micro-Worktree Pattern (WU-1127):
  This command uses micro-worktree isolation to atomically update
  package.json and pnpm-lock.yaml without requiring you to claim a WU.

  Run from your main checkout (NOT from inside a worktree):
    cd /path/to/main
    pnpm lumenflow:upgrade --latest
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

  // WU-1127: Validate we're on main checkout (not in a worktree)
  const validation = await validateMainCheckout();
  if (!validation.valid) {
    console.error(`${LOG_PREFIX} ${validation.error}`);
    if (validation.fixCommand) {
      console.error(`\nTo fix:\n${validation.fixCommand}`);
    }
    process.exit(EXIT_CODES.ERROR);
  }

  // Build upgrade commands for dry-run display
  const { addCommand, versionSpec } = buildUpgradeCommands(args);

  if (args.dryRun) {
    console.log(`${LOG_PREFIX} DRY RUN - Commands that would be executed:`);
    console.log(`  ${addCommand}`);
    console.log(`\n${LOG_PREFIX} Packages: ${LUMENFLOW_PACKAGES.length}`);
    console.log(`${LOG_PREFIX} Version: ${versionSpec}`);
    console.log(`\n${LOG_PREFIX} No changes made.`);
    process.exit(EXIT_CODES.SUCCESS);
  }

  // Execute upgrade using micro-worktree
  try {
    await executeUpgradeInMicroWorktree(args);
  } catch (error) {
    console.error(`\n${LOG_PREFIX} Upgrade failed`);
    console.error(`${LOG_PREFIX} ${error instanceof Error ? error.message : String(error)}`);
    process.exit(EXIT_CODES.ERROR);
  }
}

// Run main if executed directly
if (import.meta.main) {
  runCLI(main);
}
