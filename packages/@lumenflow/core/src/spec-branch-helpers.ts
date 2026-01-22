/**
 * Spec Branch Helpers
 *
 * WU-1062: External plan storage and no-main-write mode
 *
 * Provides helpers for working with spec branches (spec/wu-XXXX).
 * wu:create writes to spec branches by default; wu:claim merges them to main.
 *
 * @module
 */

import type { SimpleGit } from 'simple-git';
import { WU_PATHS } from './wu-paths.js';

/**
 * Spec branch prefix
 */
export const SPEC_BRANCH_PREFIX = 'spec/';

/**
 * WU source location constants
 */
export const WU_SOURCE = {
  /** WU exists on main branch only */
  MAIN: 'main',
  /** WU exists on spec branch only */
  SPEC_BRANCH: 'spec_branch',
  /** WU exists on both main and spec branch */
  BOTH: 'both',
  /** WU not found anywhere */
  NOT_FOUND: 'not_found',
} as const;

export type WUSourceType = (typeof WU_SOURCE)[keyof typeof WU_SOURCE];

/**
 * Get the spec branch name for a WU
 *
 * @param {string} wuId - Work Unit ID (e.g., 'WU-1062')
 * @returns {string} Spec branch name (e.g., 'spec/wu-1062')
 *
 * @example
 * getSpecBranchName('WU-1062') // 'spec/wu-1062'
 */
export function getSpecBranchName(wuId: string): string {
  return `${SPEC_BRANCH_PREFIX}${wuId.toLowerCase()}`;
}

/**
 * Get the origin-qualified spec branch name
 *
 * @param {string} wuId - Work Unit ID
 * @returns {string} Origin-qualified branch name (e.g., 'origin/spec/wu-1062')
 */
export function getOriginSpecBranch(wuId: string): string {
  return `origin/${getSpecBranchName(wuId)}`;
}

/**
 * Check if a spec branch exists on origin
 *
 * @param {string} wuId - Work Unit ID
 * @param {SimpleGit} git - Git adapter instance
 * @returns {Promise<boolean>} True if spec branch exists
 *
 * @example
 * const exists = await specBranchExists('WU-1062', git);
 */
export async function specBranchExists(wuId: string, git: SimpleGit): Promise<boolean> {
  try {
    const originBranch = getOriginSpecBranch(wuId);
    // Use branchExists if available, otherwise check with ls-remote
    if ('branchExists' in git && typeof git.branchExists === 'function') {
      return await (git as any).branchExists(originBranch);
    }
    // Fallback: use ls-remote to check if branch exists
    const result = await git.raw(['ls-remote', '--heads', 'origin', getSpecBranchName(wuId)]);
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if a WU exists on main branch
 *
 * @param {string} wuId - Work Unit ID
 * @param {SimpleGit} git - Git adapter instance
 * @returns {Promise<boolean>} True if WU YAML exists on main
 */
export async function isWUOnMain(wuId: string, git: SimpleGit): Promise<boolean> {
  try {
    const wuPath = WU_PATHS.WU(wuId);
    // Check if file exists on origin/main
    await git.raw(['ls-tree', 'origin/main', '--', wuPath]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge spec branch to main branch (fast-forward only)
 *
 * This is used by wu:claim when a WU exists only on a spec branch.
 * The spec branch is merged to main before creating the worktree.
 *
 * @param {string} wuId - Work Unit ID
 * @param {SimpleGit} git - Git adapter instance
 * @throws {Error} If merge fails (e.g., due to conflicts)
 *
 * @example
 * await mergeSpecBranchToMain('WU-1062', git);
 */
export async function mergeSpecBranchToMain(wuId: string, git: SimpleGit): Promise<void> {
  const specBranch = getSpecBranchName(wuId);
  const originSpecBranch = getOriginSpecBranch(wuId);

  // Fetch the spec branch
  await git.fetch('origin', specBranch);

  // Merge with fast-forward only (safe merge)
  await git.merge([originSpecBranch, '--ff-only']);
}

/**
 * Delete spec branch after merge
 *
 * @param {string} wuId - Work Unit ID
 * @param {SimpleGit} git - Git adapter instance
 */
export async function deleteSpecBranch(wuId: string, git: SimpleGit): Promise<void> {
  const specBranch = getSpecBranchName(wuId);

  try {
    // Delete local branch if exists
    await git.branch(['-d', specBranch]);
  } catch {
    // Ignore if local branch doesn't exist
  }

  try {
    // Delete remote branch
    await git.push(['origin', '--delete', specBranch]);
  } catch {
    // Ignore if remote branch doesn't exist
  }
}

/**
 * Determine the source of a WU (main, spec branch, both, or not found)
 *
 * Used by wu:claim to decide whether to merge spec branch before creating worktree.
 *
 * @param {string} wuId - Work Unit ID
 * @param {SimpleGit} git - Git adapter instance
 * @returns {Promise<WUSourceType>} Source location constant
 *
 * @example
 * const source = await getWUSource('WU-1062', git);
 * if (source === WU_SOURCE.SPEC_BRANCH) {
 *   await mergeSpecBranchToMain('WU-1062', git);
 * }
 */
export async function getWUSource(wuId: string, git: SimpleGit): Promise<WUSourceType> {
  // Check both locations in parallel for efficiency
  const [onMain, hasSpecBranch] = await Promise.all([
    isWUOnMain(wuId, git),
    specBranchExists(wuId, git),
  ]);

  if (onMain && hasSpecBranch) {
    return WU_SOURCE.BOTH;
  }

  if (onMain) {
    return WU_SOURCE.MAIN;
  }

  if (hasSpecBranch) {
    return WU_SOURCE.SPEC_BRANCH;
  }

  return WU_SOURCE.NOT_FOUND;
}

/**
 * Create a spec branch from current HEAD
 *
 * Used by wu:create in default mode (no --direct flag).
 *
 * @param {string} wuId - Work Unit ID
 * @param {SimpleGit} git - Git adapter instance
 */
export async function createSpecBranch(wuId: string, git: SimpleGit): Promise<void> {
  const specBranch = getSpecBranchName(wuId);

  // Create local branch
  await git.checkoutLocalBranch(specBranch);
}

/**
 * Push spec branch to origin
 *
 * @param {string} wuId - Work Unit ID
 * @param {SimpleGit} git - Git adapter instance
 */
export async function pushSpecBranch(wuId: string, git: SimpleGit): Promise<void> {
  const specBranch = getSpecBranchName(wuId);

  // Push to origin
  await git.push(['origin', specBranch]);
}
