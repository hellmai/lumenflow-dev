/**
 * @file worktree-guard.mjs
 * @description WU context validation and main branch protection (WU-1396)
 *
 * Provides runtime guards to enforce worktree discipline:
 * - Detect if current directory is inside a worktree
 * - Extract WU ID and lane from worktree path or git branch
 * - Throw descriptive error when write operations attempted outside worktree
 * - Check if on main/master branch
 *
 * Used by wu- scripts to prevent writes to main checkout when worktrees exist.
 * Complements .claude/hooks/user-prompt-submit-hook (human agent protection).
 *
 * @see {@link .claude/hooks/user-prompt-submit-hook} - Agent blocking hook
 * @see {@link docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md} - Worktree discipline
 */

import path from 'node:path';
import { createGitForPath } from '../git-adapter.js';
import { BRANCHES } from '../wu-constants.js';

/**
 * Worktree path pattern: worktrees/<lane-kebab>-wu-<id>
 * Captures: lane (kebab-case) and WU ID number
 *
 * Examples:
 * - worktrees/operations-tooling-wu-1396
 * - worktrees/intelligence-wu-789
 * - worktrees/core-systems-api-wu-456
 */
const WORKTREE_PATH_PATTERN = /worktrees\/([\w-]+)-wu-(\d+)/;

/**
 * Lane branch pattern: lane/<lane-kebab>/wu-<id>
 * Captures: lane (kebab-case) and WU ID number
 *
 * Examples:
 * - lane/operations-tooling/wu-1396
 * - lane/intelligence/wu-789
 * - lane/core-systems-api/wu-456
 */
const LANE_BRANCH_PATTERN = /^lane\/([\w-]+)\/wu-(\d+)$/;

/**
 * Check if on main or master branch
 *
 * @param {Object} [options] - Options
 * @param {Object} [options.git] - GitAdapter instance (for testing)
 * @returns {Promise<boolean>} True if on main/master branch
 *
 * @example
 * if (await isMainBranch()) {
 *   console.log('On main branch');
 * }
 */
export async function isMainBranch(options = {}) {
  const git = options.git || createGitForPath(process.cwd());
  const branch = await git.getCurrentBranch();

  return branch === BRANCHES.MAIN || branch === BRANCHES.MASTER;
}

/**
 * Normalize path separators to forward slashes
 *
 * Handles both Unix and Windows path separators for cross-platform compatibility.
 *
 * @param {string} p - Path to normalize
 * @returns {string} Path with forward slashes
 * @private
 */
function normalizePath(p) {
  // Replace both backslashes and path.sep with forward slashes
  // This handles Windows paths on Linux during testing
  return p.replace(/\\/g, '/').split(path.sep).join('/');
}

/**
 * Check if current directory is inside a worktree
 *
 * Detects worktree by checking if path contains worktrees/<lane>-wu-<id> pattern.
 * Works correctly from nested directories within worktree.
 *
 * @param {Object} [options] - Options
 * @param {string} [options.cwd] - Current working directory (defaults to process.cwd())
 * @returns {boolean} True if inside a worktree directory
 *
 * @example
 * if (isInWorktree()) {
 *   console.log('Working in a worktree');
 * }
 *
 * // From nested directory
 * isInWorktree({ cwd: '/project/worktrees/operations-wu-123/tools/lib' }); // true
 */
export function isInWorktree(options = {}) {
  const cwd = options.cwd || process.cwd();

  // Normalize path separators for cross-platform compatibility
  const normalizedPath = normalizePath(cwd);

  return WORKTREE_PATH_PATTERN.test(normalizedPath);
}

/**
 * Extract WU context from worktree path
 *
 * @param {string} cwd - Current working directory
 * @returns {Object|null} Context object or null if not a worktree path
 * @private
 */
function extractFromWorktreePath(cwd) {
  const normalizedPath = normalizePath(cwd);
  const match = normalizedPath.match(WORKTREE_PATH_PATTERN);

  if (!match) {
    return null;
  }

  const [fullMatch, lane, wuIdNumber] = match;
  const wuId = `WU-${wuIdNumber}`;

  // Extract just the worktrees/<lane>-wu-<id> part (not full absolute path)
  const worktreePathMatch = fullMatch.match(/(worktrees\/[\w-]+-wu-\d+)/);
  const worktreePath = worktreePathMatch ? worktreePathMatch[1] : null;

  return {
    wuId,
    lane,
    worktreePath,
  };
}

/**
 * Extract WU context from git branch name
 *
 * @param {Object} git - GitAdapter instance
 * @returns {Promise<Object|null>} Context object or null if not a lane branch
 * @private
 */
async function extractFromBranch(git) {
  const branch = await git.getCurrentBranch();
  const match = branch.match(LANE_BRANCH_PATTERN);

  if (!match) {
    return null;
  }

  const [, lane, wuIdNumber] = match;
  const wuId = `WU-${wuIdNumber}`;

  return {
    wuId,
    lane,
    worktreePath: null, // Not in worktree, on lane branch
  };
}

/**
 * Get WU context from current directory or git branch
 *
 * Extracts WU ID, lane, and worktree path from:
 * 1. Worktree directory path (priority) - works from nested directories
 * 2. Git branch name (fallback) - lane/operations-tooling/wu-1396
 *
 * @param {Object} [options] - Options
 * @param {string} [options.cwd] - Current working directory (defaults to process.cwd())
 * @param {Object} [options.git] - GitAdapter instance (for testing)
 * @returns {Promise<Object|null>} WU context or null if not in WU workspace
 *
 * @example
 * // From worktree
 * const ctx = await getWUContext();
 * // { wuId: 'WU-1396', lane: 'operations-tooling', worktreePath: 'worktrees/operations-tooling-wu-1396' }
 *
 * // From lane branch (not in worktree)
 * const ctx = await getWUContext();
 * // { wuId: 'WU-1396', lane: 'operations-tooling', worktreePath: null }
 *
 * // From main checkout on main branch
 * const ctx = await getWUContext();
 * // null
 */
export async function getWUContext(options = {}) {
  const cwd = options.cwd || process.cwd();

  // Fast path: Try worktree path first (no git operations needed)
  const worktreeContext = extractFromWorktreePath(cwd);
  if (worktreeContext) {
    return worktreeContext;
  }

  // Fallback to git branch detection (requires git operations)
  // Only create git adapter if we have one provided or if we need to check branch
  if (options.git) {
    return await extractFromBranch(options.git);
  }

  // Create git adapter only if needed (path wasn't a worktree)
  const git = createGitForPath(cwd);
  return await extractFromBranch(git);
}

/**
 * Assert that current context is inside a worktree or on a lane branch
 *
 * Throws descriptive error if:
 * - On main/master branch AND
 * - Not in a worktree directory
 *
 * Used by write operations to prevent modifications to main checkout.
 *
 * @param {Object} [options] - Options
 * @param {string} [options.cwd] - Current working directory (defaults to process.cwd())
 * @param {Object} [options.git] - GitAdapter instance (for testing)
 * @param {string} [options.operation] - Operation name for error message
 * @throws {Error} If not in worktree and on main branch
 *
 * @example
 * // In a wu- script write operation
 * await assertWorktreeRequired({ operation: 'wu:claim' });
 *
 * // Will throw if on main in main checkout:
 * // Error: BLOCKED: Operation 'wu:claim' requires a worktree.
 * //        You are on 'main' branch in main checkout.
 * //        ...
 */
export async function assertWorktreeRequired(options = {}) {
  const cwd = options.cwd || process.cwd();
  const operation = options.operation || 'this operation';

  // Fast path: Check worktree path first (no git operations needed)
  const worktreeContext = extractFromWorktreePath(cwd);
  if (worktreeContext) {
    return; // In worktree, allow operation
  }

  // Need git operations to check branch
  const git = options.git || createGitForPath(cwd);

  // Check if on lane branch
  const branchContext = await extractFromBranch(git);
  if (branchContext) {
    return; // On lane branch, allow operation
  }

  // Check if on main branch
  const onMain = await isMainBranch({ git });
  if (onMain) {
    throw new Error(
      `❌ BLOCKED: Operation '${operation}' requires a worktree.

You are on 'main' branch in main checkout.

To fix:
  1. Claim a WU first:
     pnpm wu:claim --id WU-1234 --lane "Operations: Tooling"

  2. Navigate to the worktree:
     cd worktrees/operations-tooling-wu-1234/

  3. Run your operation from the worktree.

For more information:
  See CLAUDE.md §2 (Worktree Discipline)
  See .claude/skills/worktree-discipline/SKILL.md
`
    );
  }

  // Pass if on a non-main branch (e.g., feature branch) - allow for flexibility
  // This case is less strict since it's not the main branch
}
