/**
 * Location Resolver for WU Context
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Detects whether the current working directory is:
 * - Main checkout (primary repo clone)
 * - Worktree (isolated workspace for a WU)
 * - Detached HEAD
 * - Unknown (not a git repository)
 *
 * Uses simple-git library (NOT execSync) per library-first mandate.
 *
 * @module
 */

import { simpleGit, type SimpleGit } from 'simple-git';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONTEXT_VALIDATION, PATTERNS, type LocationType } from '../wu-constants.js';

const { LOCATION_TYPES } = CONTEXT_VALIDATION;

/**
 * Location context information for WU operations.
 *
 * Captures where the command is being run from and related paths.
 */
export interface LocationContext {
  /** Location type: 'main', 'worktree', 'detached', or 'unknown' */
  type: LocationType;
  /** Absolute path to current working directory */
  cwd: string;
  /** Absolute path to git root (top-level of working tree) */
  gitRoot: string;
  /** Absolute path to main checkout (primary repo) */
  mainCheckout: string;
  /** Worktree name if in a worktree (e.g., 'framework-core-wu-1090') */
  worktreeName: string | null;
  /** WU ID extracted from worktree path (e.g., 'WU-1090') */
  worktreeWuId: string | null;
}

/**
 * Resolve current location context using simple-git library.
 *
 * Detection logic:
 * 1. Use simple-git revparse to find git root and git dir
 * 2. If .git is a file (not dir), we're in a worktree
 * 3. Parse worktree path to extract WU ID
 * 4. Find main checkout via simple-git worktree list
 *
 * @param cwd - Current working directory (defaults to process.cwd())
 * @returns Promise<LocationContext> - Resolved location context
 */
export async function resolveLocation(cwd: string = process.cwd()): Promise<LocationContext> {
  const resolvedCwd = resolve(cwd);

  try {
    const git: SimpleGit = simpleGit(resolvedCwd);

    // Get git root and git dir using simple-git revparse
    const gitRoot = (await git.revparse(['--show-toplevel'])).trim();
    const _gitDir = (await git.revparse(['--git-dir'])).trim();

    // Detect if we're in a worktree (in worktrees, .git is a file not a dir)
    // WU-1223: Fixed - check .git in gitRoot, not the gitDir path returned by rev-parse
    const isWorktree = isGitDirFile(resolve(gitRoot, '.git'));
    const mainCheckout = isWorktree ? await findMainCheckout(git) : gitRoot;

    // Parse worktree info
    const worktreeName = isWorktree ? parseWorktreeName(gitRoot, mainCheckout) : null;
    const worktreeWuId = worktreeName ? parseWuIdFromWorktree(worktreeName) : null;

    // Check if HEAD is detached (WU-1096)
    const isDetached = await isHeadDetached(git);

    // Determine location type
    const type = determineLocationType(gitRoot, mainCheckout, isWorktree, isDetached);

    return {
      type,
      cwd: resolvedCwd,
      gitRoot,
      mainCheckout,
      worktreeName,
      worktreeWuId,
    };
  } catch {
    // Not a git repository or other error
    return {
      type: LOCATION_TYPES.UNKNOWN,
      cwd: resolvedCwd,
      gitRoot: resolvedCwd,
      mainCheckout: resolvedCwd,
      worktreeName: null,
      worktreeWuId: null,
    };
  }
}

/**
 * Check if git dir is a file (worktree) vs directory (main checkout)
 *
 * In a main checkout, .git is a directory containing the repository data.
 * In a worktree, .git is a file that points to the main .git directory.
 */
function isGitDirFile(gitDir: string): boolean {
  try {
    const stat = statSync(gitDir);
    return stat.isFile();
  } catch {
    return false;
  }
}

/**
 * Find main checkout path using simple-git worktree list
 *
 * The first worktree listed is always the main checkout.
 */
async function findMainCheckout(git: SimpleGit): Promise<string> {
  try {
    // simple-git doesn't have direct worktree support, use raw command
    const result = await git.raw(['worktree', 'list', '--porcelain']);

    // First worktree listed is always the main checkout
    // Format: "worktree /path/to/repo\nHEAD ...\nbranch ...\n\nworktree ..."
    const match = result.match(/^worktree (.+)$/m);
    return match ? match[1] : process.cwd();
  } catch {
    return process.cwd();
  }
}

/**
 * Extract worktree name from path
 *
 * @example
 * parseWorktreeName('/repo/worktrees/framework-core-wu-1090', '/repo')
 * // Returns 'framework-core-wu-1090'
 */
function parseWorktreeName(gitRoot: string, mainCheckout: string): string | null {
  // Remove main checkout prefix to get relative path
  let relativePath = gitRoot;
  if (gitRoot.startsWith(mainCheckout)) {
    relativePath = gitRoot.slice(mainCheckout.length);
  }

  // Remove leading slashes
  relativePath = relativePath.replace(/^\/+/, '');

  // The worktree name is the last path component
  const parts = relativePath.split('/');
  const lastPart = parts[parts.length - 1];

  return lastPart || null;
}

/**
 * Extract WU ID from worktree name
 *
 * Uses PATTERNS.WU_ID_EXTRACT_CI (case-insensitive) from wu-constants.ts
 * because worktree names use lowercase (e.g., 'framework-core-wu-1090').
 *
 * @example
 * parseWuIdFromWorktree('framework-core-wu-1090') // 'WU-1090'
 * parseWuIdFromWorktree('some-feature') // null
 */
function parseWuIdFromWorktree(worktreeName: string): string | null {
  // Use case-insensitive pattern for worktree names
  const match = worktreeName.match(PATTERNS.WU_ID_EXTRACT_CI);
  return match ? match[0].toUpperCase() : null;
}

/**
 * Check if HEAD is detached using git symbolic-ref
 *
 * WU-1096: Detect detached HEAD state and return DETACHED location type.
 *
 * When HEAD is attached to a branch, `git symbolic-ref HEAD` returns
 * the ref name (e.g., 'refs/heads/main'). When detached, it fails
 * with 'fatal: ref HEAD is not a symbolic ref'.
 *
 * @param git - SimpleGit instance
 * @returns Promise<boolean> - true if HEAD is detached
 */
async function isHeadDetached(git: SimpleGit): Promise<boolean> {
  try {
    // git symbolic-ref HEAD succeeds when HEAD is attached to a branch
    await git.raw(['symbolic-ref', 'HEAD']);
    return false; // HEAD is attached
  } catch {
    // git symbolic-ref HEAD fails when HEAD is detached
    return true;
  }
}

/**
 * Determine location type from context
 *
 * WU-1096: Added isDetached parameter to detect detached HEAD state.
 */
function determineLocationType(
  gitRoot: string,
  mainCheckout: string,
  isWorktree: boolean,
  isDetached: boolean = false,
): LocationType {
  if (isWorktree) return LOCATION_TYPES.WORKTREE;
  if (isDetached) return LOCATION_TYPES.DETACHED;
  if (gitRoot === mainCheckout) return LOCATION_TYPES.MAIN;
  return LOCATION_TYPES.UNKNOWN;
}
