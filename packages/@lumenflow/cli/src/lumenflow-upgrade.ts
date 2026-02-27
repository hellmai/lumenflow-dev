#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only
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

import { execSync, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
import { generateScriptsFromManifest } from './public-manifest.js';

/** Log prefix for console output */
const LOG_PREFIX = '[lumenflow:upgrade]';

/** Operation name for micro-worktree */
const OPERATION_NAME = 'lumenflow-upgrade';

/** CLI argument names */
const ARG_HELP = '--help';
const ARG_HELP_SHORT = '-h';
const ARG_VERSION = '--version';
const ARG_VERSION_SHORT = '-v';
const ARG_LATEST = '--latest';
const ARG_LATEST_SHORT = '-l';
const ARG_DRY_RUN = '--dry-run';
const ARG_DRY_RUN_SHORT = '-n';
const ARG_NO_BOOTSTRAP = '--no-bootstrap';
const PNPM_WORKSPACE_FILE = 'pnpm-workspace.yaml';

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
  /** WU-2087: Skip self-bootstrap (set by bootstrap process to prevent recursion) */
  noBootstrap?: boolean;
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

export interface BuildUpgradeOptions {
  /** Working directory used to detect pnpm workspace root context */
  cwd?: string;
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
 * Detect whether a project is a pnpm workspace root.
 */
export function isWorkspaceRoot(cwd: string = process.cwd()): boolean {
  return existsSync(path.join(cwd, PNPM_WORKSPACE_FILE));
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

    if (arg === ARG_HELP || arg === ARG_HELP_SHORT) {
      args.help = true;
    } else if (arg === ARG_VERSION || arg === ARG_VERSION_SHORT) {
      args.version = cliArgs[++i];
    } else if (arg === ARG_LATEST || arg === ARG_LATEST_SHORT) {
      args.latest = true;
    } else if (arg === ARG_DRY_RUN || arg === ARG_DRY_RUN_SHORT) {
      args.dryRun = true;
    } else if (arg === ARG_NO_BOOTSTRAP) {
      args.noBootstrap = true;
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
export function buildUpgradeCommands(
  args: UpgradeArgs,
  options: BuildUpgradeOptions = {},
): UpgradeResult {
  // Determine version specifier
  const versionSpec = args.latest ? 'latest' : args.version || 'latest';

  // Build package list with version
  const packages = LUMENFLOW_PACKAGES.map((pkg) => `${pkg}@${versionSpec}`);

  // Build pnpm add command using array pattern (matches deps-add.ts convention).
  // -w is required in workspace roots but fails in single-package repos.
  const parts: string[] = [PKG_MANAGER, PKG_COMMANDS.ADD, PKG_FLAGS.SAVE_DEV];
  const shouldUseWorkspaceRootFlag = isWorkspaceRoot(options.cwd ?? process.cwd());
  if (shouldUseWorkspaceRootFlag) {
    parts.push(PKG_FLAGS.WORKSPACE_ROOT);
  }
  parts.push(...packages);

  return {
    addCommand: parts.join(' '),
    versionSpec,
  };
}

/**
 * WU-2087: Get the installed @lumenflow/cli version from its package.json.
 *
 * Uses import.meta.resolve to locate the package.json relative to this module,
 * which works correctly regardless of whether we're in the main checkout or a
 * micro-worktree, and handles both symlinked and real dist directories.
 *
 * @returns Semver version string (e.g., '3.2.1') or null if not determinable
 */
export function getInstalledCliVersion(): string | null {
  // Strategy 1: Resolve relative to this file (works in dev monorepo and tests)
  try {
    const thisDir = path.dirname(new URL(import.meta.url).pathname);
    // In dist: packages/@lumenflow/cli/dist/ → ../package.json
    // In src:  packages/@lumenflow/cli/src/  → ../package.json
    const localPkg = path.join(thisDir, '..', 'package.json');
    if (existsSync(localPkg)) {
      const pkg = JSON.parse(readFileSync(localPkg, 'utf8'));
      if (pkg.version) return pkg.version;
    }
  } catch {
    // Fall through to strategy 2
  }

  // Strategy 2: Use import.meta.resolve (works for installed npm packages)
  try {
    const pkgUrl = import.meta.resolve('@lumenflow/cli/package.json');
    const pkgPath = pkgUrl.startsWith('file://') ? new URL(pkgUrl).pathname : pkgUrl;
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    return pkg.version || null;
  } catch {
    return null;
  }
}

/**
 * WU-2087: Resolve the concrete target version for the upgrade.
 *
 * - For --version X: returns X directly (no network call)
 * - For --latest: queries the npm registry via `npm view` to resolve the
 *   current latest tag to a concrete semver version
 * - Returns null on failure (offline, registry error) — callers should
 *   degrade gracefully and proceed with the installed version
 *
 * @param args - Parsed upgrade arguments
 * @returns Concrete semver string or null
 */
export async function resolveTargetVersion(args: UpgradeArgs): Promise<string | null> {
  if (args.version) return args.version;
  if (args.latest) {
    try {
      // execFileSync avoids shell injection — all args are array elements
      // eslint-disable-next-line sonarjs/no-os-command-from-path -- npm is a system binary
      const result = execFileSync('npm', ['view', '@lumenflow/cli', 'version'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      return result || null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * WU-2087: Build the command to delegate to the target version's upgrade script.
 *
 * Creates a { script, args } pair that runs the target version's
 * lumenflow-upgrade.js from a temp bootstrap directory.
 *
 * The args are constructed by:
 * 1. Dropping 'node' and the script path from original argv
 * 2. Replacing --latest with --version <resolved> (avoids re-resolving)
 * 3. Adding --no-bootstrap to prevent infinite recursion
 *
 * @param bootstrapDir - Temp dir where target CLI was npm-installed
 * @param targetVersion - Resolved concrete version (e.g., '3.5.0')
 * @param originalArgv - process.argv from the current invocation
 * @returns { script, args } for execFileSync
 */
export function buildBootstrapCommand(
  bootstrapDir: string,
  targetVersion: string,
  originalArgv: string[],
): { script: string; args: string[] } {
  const script = path.join(
    bootstrapDir,
    'node_modules',
    '@lumenflow',
    'cli',
    'dist',
    'lumenflow-upgrade.js',
  );

  // Forward original CLI args, replacing --latest with --version <resolved>
  const cliArgs = originalArgv.slice(2).filter((a) => a !== ARG_NO_BOOTSTRAP);
  const args: string[] = [];
  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];
    if (arg === ARG_LATEST || arg === ARG_LATEST_SHORT) {
      // Replace --latest with --version <resolved> so the target script
      // doesn't need to re-resolve from the registry
      args.push(ARG_VERSION, targetVersion);
    } else {
      args.push(arg);
    }
  }
  args.push(ARG_NO_BOOTSTRAP);

  return { script, args };
}

/**
 * WU-2087: Self-bootstrap by installing the target version in a temp dir
 * and delegating the upgrade to it.
 *
 * This solves the chicken-and-egg problem: when the installed version has
 * bugs (e.g., unconditional -w flag), the target version's script runs
 * instead. Node ESM resolves imports relative to the script's file location,
 * so @lumenflow/core etc. are loaded from the temp dir's node_modules —
 * NOT from the consumer's stale node_modules.
 *
 * The temp dir is always cleaned up, even on failure.
 *
 * @param targetVersion - Concrete version to bootstrap (e.g., '3.5.0')
 * @param originalArgv - process.argv to forward (with --no-bootstrap added)
 */
export function selfBootstrap(targetVersion: string, originalArgv: string[]): void {
  const bootstrapDir = mkdtempSync(path.join(tmpdir(), 'lf-upgrade-bootstrap-'));

  try {
    console.log(`${LOG_PREFIX} Self-bootstrapping to @lumenflow/cli@${targetVersion}...`);

    // Create minimal package.json so npm install works
    writeFileSync(
      path.join(bootstrapDir, 'package.json'),
      JSON.stringify({ name: 'lf-bootstrap', private: true }),
    );

    // Install target version — execFileSync prevents shell injection
    console.log(`${LOG_PREFIX} Installing @lumenflow/cli@${targetVersion} in temp environment...`);
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- npm is a system binary
    execFileSync('npm', ['install', '--no-save', `@lumenflow/cli@${targetVersion}`], {
      cwd: bootstrapDir,
      stdio: STDIO_MODES.PIPE,
    });

    // Build and run the target version's upgrade script
    const { script, args } = buildBootstrapCommand(bootstrapDir, targetVersion, originalArgv);
    console.log(`${LOG_PREFIX} Delegating to target version's upgrade script...`);
    // eslint-disable-next-line sonarjs/no-os-command-from-path -- node is a system binary
    execFileSync('node', [script, ...args], {
      cwd: process.cwd(),
      stdio: STDIO_MODES.INHERIT,
    });
  } finally {
    rmSync(bootstrapDir, { recursive: true, force: true });
  }
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
 * WU-2226: Result of syncing scripts from the public manifest
 */
export interface ScriptSyncResult {
  /** Script names that were added */
  added: string[];
  /** Whether package.json was modified */
  modified: boolean;
}

/**
 * WU-2226: Sync pnpm script entries from the CLI public-manifest into
 * the consumer project's package.json.
 *
 * Adds missing scripts without overwriting or removing existing entries.
 * Uses the same script generation logic as `lumenflow init` to ensure
 * consistency between init-scaffolded and upgrade-synced scripts.
 *
 * @param dir - Directory containing the package.json to update
 * @returns ScriptSyncResult indicating what was changed
 */
export function syncScriptsToPackageJson(dir: string): ScriptSyncResult {
  const pkgPath = path.join(dir, 'package.json');

  if (!existsSync(pkgPath)) {
    return { added: [], modified: false };
  }

  const content = readFileSync(pkgPath, 'utf-8');
  const packageJson = JSON.parse(content) as Record<string, unknown>;

  // Ensure scripts object exists
  if (!packageJson.scripts || typeof packageJson.scripts !== 'object') {
    packageJson.scripts = {};
  }

  const scripts = packageJson.scripts as Record<string, string>;
  const manifestScripts = generateScriptsFromManifest();
  const added: string[] = [];

  for (const [name, command] of Object.entries(manifestScripts)) {
    if (!(name in scripts)) {
      scripts[name] = command;
      added.push(name);
    }
  }

  const modified = added.length > 0;

  if (modified) {
    writeFileSync(pkgPath, JSON.stringify(packageJson, null, 2) + '\n');
  }

  return { added, modified };
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

      // WU-2226: Sync missing pnpm script entries from the public manifest.
      // New CLI versions may introduce new commands (e.g., wu:escalate) that
      // need corresponding script entries in the consumer's package.json.
      const scriptSync = syncScriptsToPackageJson(worktreePath);
      if (scriptSync.modified) {
        console.log(
          `${LOG_PREFIX} Added ${scriptSync.added.length} new script entries: ${scriptSync.added.join(', ')}`,
        );
      } else {
        console.log(`${LOG_PREFIX} All script entries already present`);
      }

      // Return files to stage and commit message
      return {
        commitMessage: `chore: upgrade @lumenflow packages to ${versionSpec}`,
        files: ['package.json', 'pnpm-lock.yaml'],
      };
    },
  });

  // WU-1622: Sync main checkout's node_modules after merge.
  // The micro-worktree updated package.json + lockfile and merged to main,
  // but main's node_modules still has the old packages. Without this step,
  // git hooks (pre-push, pre-commit) that import from @lumenflow/* would
  // crash because they resolve from the stale node_modules.
  // Note: execSync is safe here — no user input in the command string.
  console.log(`${LOG_PREFIX} Syncing node_modules with updated lockfile...`);
  execSync(`${PKG_MANAGER} install --frozen-lockfile`, {
    stdio: STDIO_MODES.INHERIT,
  });
  console.log(`${LOG_PREFIX} ✅ node_modules synced`);

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

Options:
  -v, --version <ver>        Upgrade to specific version (e.g., 1.5.0)
  -l, --latest               Upgrade to latest version
  -n, --dry-run              Show commands without executing
  --no-bootstrap             Skip self-bootstrap (use installed version as-is)
  -h, --help                 Show this help message

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
export async function main(): Promise<void> {
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

  // WU-2087: Self-bootstrap to target version when installed version differs.
  // This solves the chicken-and-egg problem: if the installed version has bugs
  // (e.g., unconditional -w flag in v3.1.2), we delegate to the target version
  // which has the fix. Degrades gracefully if version resolution fails.
  if (!args.noBootstrap) {
    const targetVersion = await resolveTargetVersion(args);
    const installedVersion = getInstalledCliVersion();

    if (targetVersion && installedVersion && targetVersion !== installedVersion) {
      console.log(
        `${LOG_PREFIX} Installed: v${installedVersion}, target: v${targetVersion} — self-bootstrapping`,
      );
      try {
        selfBootstrap(targetVersion, process.argv);
        process.exit(EXIT_CODES.SUCCESS);
      } catch (error) {
        console.warn(
          `${LOG_PREFIX} Self-bootstrap failed, proceeding with installed version: ${error instanceof Error ? error.message : String(error)}`,
        );
        // Fall through to use installed version
      }
    }
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
  void runCLI(main);
}
