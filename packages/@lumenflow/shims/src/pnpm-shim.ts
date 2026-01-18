#!/usr/bin/env node
/**
 * @lumenflow/shims - pnpm Command Shim (WU-2546)
 *
 * Fixes ERR_PNPM_UNEXPECTED_VIRTUAL_STORE error in git worktrees.
 *
 * Problem: pnpm computes virtual-store-dir relative to the project root before
 * following symlinks. In worktrees with symlinked node_modules, this results in
 * a path mismatch because main and worktree compute different absolute paths.
 *
 * Solution: This shim dynamically computes the main checkout's virtual store
 * path using `git rev-parse --git-common-dir` and passes it to pnpm via
 * --config.virtual-store-dir.
 *
 * Usage: Add shims directory to PATH before npm/pnpm bin locations
 *   export PATH="$(pwd)/node_modules/.bin:$PATH"
 *
 * @module @lumenflow/shims/pnpm
 */

import { spawnSync, execSync } from 'node:child_process';
import path from 'node:path';
import type { PnpmShimConfig } from './types.js';
import { PnpmShimConfigSchema } from './types.js';
import { isInWorktree, getMainCheckoutPath } from './worktree.js';

/**
 * Default configuration.
 */
const DEFAULT_CONFIG: PnpmShimConfig = PnpmShimConfigSchema.parse({});

/**
 * Find real pnpm executable (after removing shims from PATH).
 *
 * @param config - Pnpm shim configuration
 * @returns Path to real pnpm
 */
export function findRealPnpm(config: PnpmShimConfig = DEFAULT_CONFIG): string {
  // Build list of candidate paths: system paths + user home paths
  const userHomePaths = [
    path.join(process.env['HOME'] || '', '.local', 'share', 'pnpm', 'pnpm'),
    path.join(process.env['HOME'] || '', '.pnpm-home', 'pnpm'),
  ];
  const candidatePaths = [...config.systemPnpmPaths, ...userHomePaths];

  for (const pnpmPath of candidatePaths) {
    try {
      const result = spawnSync(pnpmPath, ['--version'], {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      if (result.status === 0) {
        return pnpmPath;
      }
    } catch {
      // Try next path
    }
  }

  // Fallback: use which to find pnpm (exclude our shim)
  try {
    const pathWithoutShims = (process.env['PATH'] || '')
      .split(':')
      .filter((p) => !p.includes('tools/shims') && !p.includes('@lumenflow/shims'))
      .join(':');

    const result = execSync('which pnpm', {
      encoding: 'utf8',
      env: { ...process.env, PATH: pathWithoutShims },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.trim();
  } catch {
    return 'pnpm';
  }
}

/**
 * Check if the command modifies dependencies.
 *
 * @param args - pnpm command arguments
 * @param config - Pnpm shim configuration
 * @returns True if command modifies dependencies
 */
export function isDependencyCommand(
  args: string[],
  config: PnpmShimConfig = DEFAULT_CONFIG,
): boolean {
  const command = args[0]?.toLowerCase() ?? '';
  return config.dependencyCommands.includes(command);
}

/**
 * Run the pnpm shim with given configuration.
 *
 * @param args - pnpm command arguments
 * @param config - Pnpm shim configuration
 * @returns Exit code
 */
export function runPnpmShim(args: string[], config: PnpmShimConfig = DEFAULT_CONFIG): number {
  // Recursion guard
  if (process.env[config.recursionEnvVar]) {
    const realPnpm = findRealPnpm(config);
    const result = spawnSync(realPnpm, args, {
      stdio: 'inherit',
      encoding: 'utf8',
    });
    return result.status || 0;
  }
  process.env[config.recursionEnvVar] = '1';

  // Only apply fix for dependency commands in worktrees
  if (isInWorktree() && isDependencyCommand(args, config)) {
    const mainCheckout = getMainCheckoutPath();

    if (mainCheckout) {
      const virtualStorePath = path.join(mainCheckout, 'node_modules', '.pnpm');

      // Inject virtual-store-dir config before passing to pnpm
      const newArgs = [`--config.virtual-store-dir=${virtualStorePath}`, ...args];

      // Log that we're applying the worktree fix (helpful for debugging)
      if (config.enableDebug || process.env['DEBUG_PNPM_SHIM']) {
        console.error(
          `[pnpm-shim] Worktree detected, setting virtual-store-dir=${virtualStorePath}`,
        );
      }

      const realPnpm = findRealPnpm(config);
      const result = spawnSync(realPnpm, newArgs, {
        stdio: 'inherit',
        encoding: 'utf8',
      });

      return result.status || 0;
    }
  }

  // Default: pass through to real pnpm unchanged
  const realPnpm = findRealPnpm(config);
  const result = spawnSync(realPnpm, args, {
    stdio: 'inherit',
    encoding: 'utf8',
  });

  return result.status || 0;
}

/**
 * Main entry point for CLI execution.
 */
export function main(): void {
  const args = process.argv.slice(2);
  const exitCode = runPnpmShim(args);
  process.exit(exitCode);
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
