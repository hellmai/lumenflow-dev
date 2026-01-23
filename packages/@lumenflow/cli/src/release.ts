#!/usr/bin/env node
/**
 * Release Command
 *
 * Orchestrates npm release for all @lumenflow/* packages using micro-worktree isolation.
 *
 * Features:
 * - Validates semver version format
 * - Bumps all @lumenflow/* package versions atomically
 * - Uses micro-worktree isolation for version commit (no main branch pollution)
 * - Builds all packages via turbo
 * - Publishes to npm with proper auth (requires NPM_TOKEN)
 * - Creates git tag vX.Y.Z
 *
 * Usage:
 *   pnpm release --version 1.3.0
 *   pnpm release --version 1.3.0 --dry-run     # Preview without making changes
 *   pnpm release --version 1.3.0 --skip-publish # Bump and tag only (no npm publish)
 *
 * WU-1074: Add release command for npm publishing
 */

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { getGitForCwd } from '@lumenflow/core/dist/git-adapter.js';
import { die } from '@lumenflow/core/dist/error-handler.js';
import { withMicroWorktree } from '@lumenflow/core/dist/micro-worktree.js';
import { ensureOnMain } from '@lumenflow/core/dist/wu-helpers.js';
import {
  REMOTES,
  BRANCHES,
  FILE_SYSTEM,
  STDIO_MODES,
  EXIT_CODES,
  PKG_MANAGER,
} from '@lumenflow/core/dist/wu-constants.js';
import { runCLI } from './cli-entry-point.js';

/** Log prefix for console output */
const LOG_PREFIX = '[release]';

/** Micro-worktree operation name */
const OPERATION_NAME = 'release';

/** Directory containing @lumenflow packages */
const LUMENFLOW_PACKAGES_DIR = 'packages/@lumenflow';

/** Semver regex pattern (strict) */
const SEMVER_REGEX = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?$/;

/** JSON indent size for package.json files */
const JSON_INDENT = 2;

/** Default npm registry */
const NPM_REGISTRY = 'https://registry.npmjs.org';

/** Environment variable for npm authentication token */
const NPM_TOKEN_ENV = 'NPM_TOKEN';

/** Environment variable for alternative npm auth */
const NODE_AUTH_TOKEN_ENV = 'NODE_AUTH_TOKEN';

/**
 * Release command options
 */
export interface ReleaseOptions {
  version: string;
  dryRun?: boolean;
  skipPublish?: boolean;
  skipBuild?: boolean;
}

/**
 * Validate that a string is a valid semver version
 *
 * @param version - Version string to validate
 * @returns true if valid semver, false otherwise
 */
export function validateSemver(version: string): boolean {
  if (!version || typeof version !== 'string') {
    return false;
  }
  return SEMVER_REGEX.test(version);
}

/**
 * Find all public @lumenflow/* package.json paths
 *
 * @param baseDir - Base directory to search from (defaults to cwd)
 * @returns Array of absolute paths to package.json files
 */
export function findPackageJsonPaths(baseDir: string = process.cwd()): string[] {
  const packagesDir = join(baseDir, LUMENFLOW_PACKAGES_DIR);
  const paths: string[] = [];

  if (!existsSync(packagesDir)) {
    return paths;
  }

  const entries = readdirSync(packagesDir);
  for (const entry of entries) {
    const entryPath = join(packagesDir, entry);
    const packageJsonPath = join(entryPath, 'package.json');

    if (statSync(entryPath).isDirectory() && existsSync(packageJsonPath)) {
      // Read package.json to check if it's private
      const content = JSON.parse(
        readFileSync(packageJsonPath, { encoding: FILE_SYSTEM.UTF8 as BufferEncoding }),
      );

      // Only include public packages (not marked private)
      if (!content.private) {
        paths.push(packageJsonPath);
      }
    }
  }

  return paths;
}

/**
 * Update version in specified package.json files
 *
 * @param paths - Array of package.json paths
 * @param version - New version string
 */
export async function updatePackageVersions(paths: string[], version: string): Promise<void> {
  for (const packagePath of paths) {
    const content = await readFile(packagePath, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
    const pkg = JSON.parse(content);

    // Update version
    pkg.version = version;

    // Write back with preserved formatting (2-space indent)
    const updated = JSON.stringify(pkg, null, JSON_INDENT) + '\n';
    await writeFile(packagePath, updated, { encoding: FILE_SYSTEM.ENCODING as BufferEncoding });
  }
}

/**
 * Build commit message for version bump
 *
 * @param version - New version string
 * @returns Commit message
 */
export function buildCommitMessage(version: string): string {
  return `chore: bump all packages to v${version}`;
}

/**
 * Build git tag name from version
 *
 * @param version - Version string
 * @returns Git tag name with 'v' prefix
 */
export function buildTagName(version: string): string {
  return `v${version}`;
}

/**
 * Get relative path from worktree root
 *
 * @param absolutePath - Absolute file path
 * @param worktreePath - Worktree root path
 * @returns Relative path
 */
function getRelativePath(absolutePath: string, worktreePath: string): string {
  return absolutePath.replace(worktreePath + '/', '');
}

/**
 * Execute a shell command and handle errors
 *
 * @param cmd - Command to execute
 * @param options - Options for execution
 */
function runCommand(
  cmd: string,
  options: { cwd?: string; dryRun?: boolean; label?: string } = {},
): void {
  const { cwd = process.cwd(), dryRun = false, label } = options;
  const prefix = label ? `[${label}] ` : '';

  if (dryRun) {
    console.log(`${LOG_PREFIX} ${prefix}Would run: ${cmd}`);
    return;
  }

  console.log(`${LOG_PREFIX} ${prefix}Running: ${cmd}`);
  try {
    execSync(cmd, {
      cwd,
      stdio: 'inherit',
      encoding: FILE_SYSTEM.ENCODING as BufferEncoding,
    });
  } catch (error) {
    throw new Error(`Command failed: ${cmd}`);
  }
}

/**
 * Check if npm authentication is available
 *
 * @returns true if NPM_TOKEN or NODE_AUTH_TOKEN is set
 */
function hasNpmAuth(): boolean {
  return Boolean(process.env[NPM_TOKEN_ENV] || process.env[NODE_AUTH_TOKEN_ENV]);
}

/**
 * Main release function
 */
async function main(): Promise<void> {
  const program = new Command()
    .name('release')
    .description('Release @lumenflow/* packages to npm with version bump, tag, and publish')
    .requiredOption('-v, --version <version>', 'Semver version to release (e.g., 1.3.0)')
    .option('--dry-run', 'Preview changes without making them', false)
    .option('--skip-publish', 'Skip npm publish (only bump and tag)', false)
    .option('--skip-build', 'Skip build step (use existing dist)', false)
    .helpOption('-h, --help', 'Display help for command');

  program.parse();
  const opts = program.opts() as ReleaseOptions;

  const { version, dryRun, skipPublish, skipBuild } = opts;

  console.log(`${LOG_PREFIX} Starting release process for v${version}`);
  if (dryRun) {
    console.log(`${LOG_PREFIX} DRY RUN MODE - no changes will be made`);
  }

  // Validate version format
  if (!validateSemver(version)) {
    die(
      `Invalid semver version: ${version}\n\n` +
        `Expected format: MAJOR.MINOR.PATCH (e.g., 1.3.0)\n` +
        `Optional pre-release suffix: 1.3.0-alpha, 1.3.0-beta.1`,
    );
  }

  // Ensure we're on main branch
  const git = getGitForCwd();
  await ensureOnMain(git);

  // Check for uncommitted changes
  const isClean = await git.isClean();
  if (!isClean) {
    die(
      `Working directory has uncommitted changes.\n\n` +
        `Commit or stash changes before releasing:\n` +
        `  git status\n` +
        `  git stash  # or git commit`,
    );
  }

  // Find all @lumenflow/* packages to update
  const packagePaths = findPackageJsonPaths();
  if (packagePaths.length === 0) {
    die(`No @lumenflow/* packages found in ${LUMENFLOW_PACKAGES_DIR}`);
  }

  console.log(`${LOG_PREFIX} Found ${packagePaths.length} packages to update:`);
  for (const p of packagePaths) {
    console.log(`  - ${p.replace(process.cwd() + '/', '')}`);
  }

  // Check npm authentication for publish
  if (!skipPublish && !dryRun && !hasNpmAuth()) {
    die(
      `npm authentication not found.\n\n` +
        `Set one of these environment variables:\n` +
        `  export NPM_TOKEN=<your-npm-token>\n` +
        `  export NODE_AUTH_TOKEN=<your-npm-token>\n\n` +
        `Get a token at: https://www.npmjs.com/settings/tokens\n` +
        `Or use --skip-publish to only bump versions and create tag.`,
    );
  }

  // Execute version bump in micro-worktree
  if (dryRun) {
    console.log(`${LOG_PREFIX} Would bump versions to ${version} using micro-worktree isolation`);
    console.log(`${LOG_PREFIX} Would commit: ${buildCommitMessage(version)}`);
  } else {
    console.log(`${LOG_PREFIX} Bumping versions using micro-worktree isolation...`);

    await withMicroWorktree({
      operation: OPERATION_NAME,
      id: `v${version}`,
      logPrefix: LOG_PREFIX,
      execute: async ({ worktreePath }) => {
        // Find package paths within the worktree
        const worktreePackagePaths = findPackageJsonPaths(worktreePath);

        // Update versions
        console.log(`${LOG_PREFIX} Updating ${worktreePackagePaths.length} package versions...`);
        await updatePackageVersions(worktreePackagePaths, version);

        // Get relative paths for commit
        const relativePaths = worktreePackagePaths.map((p) => getRelativePath(p, worktreePath));

        console.log(`${LOG_PREFIX} ✅ Versions updated to ${version}`);

        return {
          commitMessage: buildCommitMessage(version),
          files: relativePaths,
        };
      },
    });

    console.log(`${LOG_PREFIX} ✅ Version bump committed and pushed`);
  }

  // Build packages
  if (!skipBuild) {
    runCommand(`${PKG_MANAGER} build`, { dryRun, label: 'build' });
    console.log(`${LOG_PREFIX} ✅ Build complete`);
  } else {
    console.log(`${LOG_PREFIX} Skipping build (--skip-build)`);
  }

  // Create git tag
  const tagName = buildTagName(version);
  if (dryRun) {
    console.log(`${LOG_PREFIX} Would create tag: ${tagName}`);
    console.log(`${LOG_PREFIX} Would push tag to ${REMOTES.ORIGIN}`);
  } else {
    console.log(`${LOG_PREFIX} Creating tag ${tagName}...`);
    await git.raw(['tag', '-a', tagName, '-m', `Release ${tagName}`]);
    console.log(`${LOG_PREFIX} ✅ Tag created: ${tagName}`);

    console.log(`${LOG_PREFIX} Pushing tag to ${REMOTES.ORIGIN}...`);
    await git.push(REMOTES.ORIGIN, tagName);
    console.log(`${LOG_PREFIX} ✅ Tag pushed`);
  }

  // Publish to npm
  if (!skipPublish) {
    if (dryRun) {
      console.log(`${LOG_PREFIX} Would publish packages to npm`);
    } else {
      console.log(`${LOG_PREFIX} Publishing packages to npm...`);
      runCommand(`${PKG_MANAGER} -r publish --access public --no-git-checks`, { label: 'publish' });
      console.log(`${LOG_PREFIX} ✅ Packages published to npm`);
    }
  } else {
    console.log(`${LOG_PREFIX} Skipping npm publish (--skip-publish)`);
  }

  // Summary
  console.log(`\n${LOG_PREFIX} 🎉 Release complete!`);
  console.log(`${LOG_PREFIX} Version: ${version}`);
  console.log(`${LOG_PREFIX} Tag: ${tagName}`);
  if (!skipPublish && !dryRun) {
    console.log(`${LOG_PREFIX} npm: https://www.npmjs.com/org/lumenflow`);
  }

  console.log(`\n${LOG_PREFIX} Next steps:`);
  if (dryRun) {
    console.log(`  - Run without --dry-run to execute the release`);
  } else {
    console.log(`  - Create GitHub release: gh release create ${tagName} --title "Release ${tagName}"`);
    if (skipPublish) {
      console.log(`  - Publish to npm: ${PKG_MANAGER} -r publish --access public --no-git-checks`);
    }
    console.log(`  - Verify packages: npm view @lumenflow/cli version`);
  }
}

// Export for testing
export { main };

// Guard main() for testability
if (import.meta.main) {
  runCLI(main);
}
