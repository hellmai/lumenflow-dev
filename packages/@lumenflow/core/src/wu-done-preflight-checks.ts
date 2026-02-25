#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Pre-merge validation checks for wu:done
 *
 * Extracted from wu-done-worktree.ts to enforce single responsibility.
 * Each function performs one specific pre-flight check before merge.
 *
 * Functions:
 *   checkBranchDrift      - Verify branch is not too far behind main
 *   checkBranchDivergence - Detect and optionally auto-rebase diverged branches
 *   checkMergeCommits     - Detect merge commits that violate linear history
 *   checkMergeConflicts   - Detect merge conflicts using git merge-tree
 *   checkEmptyMerge       - Detect empty merges with no work commits
 */

import { spawnSync } from 'node:child_process';
import { getGitForCwd } from './git-adapter.js';
import {
  BRANCHES,
  REMOTES,
  THRESHOLDS,
  LOG_PREFIX,
  STRING_LITERALS,
  GIT_COMMANDS,
  GIT_FLAGS,
} from './wu-constants.js';
import { PREFLIGHT } from './wu-done-messages.js';
import { createError, ErrorCodes, getErrorMessage } from './error-handler.js';
import { createValidationError } from './wu-done-errors.js';
import { autoRebaseBranch } from './wu-done-rebase.js';

function isErrorWithCode(error: unknown, code: string): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === code;
}

/**
 * Options for branch divergence and merge commit checks.
 */
export interface CheckBranchOptions {
  /** Automatically rebase if diverged */
  autoRebase?: boolean;
  /** Path to worktree (required if autoRebase=true) */
  worktreePath?: string | null;
  /** WU ID for artifact cleanup (e.g., 'WU-1371') */
  wuId?: string | null;
}

/**
 * Check for branch drift (commits behind main)
 * WU-755 pre-flight check
 *
 * @param {string} branch - Lane branch name
 * @returns {Promise<number>} Number of commits behind main
 */
export async function checkBranchDrift(branch: string): Promise<number> {
  const gitAdapter = getGitForCwd();
  try {
    const counts = await gitAdapter.revList([
      '--left-right',
      '--count',
      `${BRANCHES.MAIN}...${branch}`,
    ]);
    const [mainAheadRaw] = counts.split(/\s+/).map(Number);
    const mainAhead =
      typeof mainAheadRaw === 'number' && Number.isFinite(mainAheadRaw) ? mainAheadRaw : 0;

    if (mainAhead > THRESHOLDS.BRANCH_DRIFT_MAX) {
      throw createError(
        ErrorCodes.GIT_ERROR,
        PREFLIGHT.BRANCH_DRIFT_ERROR(
          mainAhead,
          THRESHOLDS.BRANCH_DRIFT_MAX,
          REMOTES.ORIGIN,
          BRANCHES.MAIN,
        ),
        { branch, commitsBehind: mainAhead, threshold: THRESHOLDS.BRANCH_DRIFT_MAX },
      );
    }

    return mainAhead;
  } catch (e: unknown) {
    if (isErrorWithCode(e, ErrorCodes.GIT_ERROR)) throw e;
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check branch drift: ${getErrorMessage(e)}`);
    return 0;
  }
}

/**
 * Check for branch divergence (main has advanced since branch creation)
 * WU-1303: Added autoRebase option (default ON) to automatically rebase diverged branches
 * WU-1371: Added wuId option for post-rebase artifact cleanup
 *
 * @param {string} branch - Lane branch name
 * @param {CheckBranchOptions} [options] - Check options
 * @throws {Error} If divergence detected and auto-rebase fails or is disabled
 */
export async function checkBranchDivergence(
  branch: string,
  options: CheckBranchOptions = {},
): Promise<void> {
  const { autoRebase = true, worktreePath = null, wuId = null } = options;
  const gitAdapter = getGitForCwd();

  try {
    const mergeBase = await gitAdapter.mergeBase(BRANCHES.MAIN, branch);
    const mainHead = await gitAdapter.getCommitHash(BRANCHES.MAIN);

    if (mergeBase !== mainHead) {
      const mainCommitsAhead = await gitAdapter.revList([
        '--count',
        `${mergeBase}..${BRANCHES.MAIN}`,
      ]);
      const commitCount = Number(mainCommitsAhead);

      console.log(PREFLIGHT.DIVERGENCE_DETECTED(commitCount));

      // Attempt auto-rebase if enabled and worktree path provided
      if (autoRebase && worktreePath) {
        const rebaseResult = await autoRebaseBranch(branch, worktreePath, wuId);
        if (rebaseResult.success) {
          // Rebase succeeded - continue with wu:done
          return;
        }

        // Rebase failed - throw with detailed instructions
        throw createError(ErrorCodes.GIT_ERROR, rebaseResult.error ?? 'Auto-rebase failed', {
          branch,
          mergeBase,
          mainHead,
          mainCommitsAhead: commitCount,
          autoRebaseAttempted: true,
        });
      }

      // Auto-rebase disabled or no worktree path - throw with manual instructions
      throw createError(
        ErrorCodes.GIT_ERROR,
        PREFLIGHT.DIVERGENCE_ERROR(commitCount, REMOTES.ORIGIN, BRANCHES.MAIN, branch),
        { branch, mergeBase, mainHead, mainCommitsAhead: commitCount },
      );
    }

    console.log(PREFLIGHT.NO_DIVERGENCE);
  } catch (e: unknown) {
    if (isErrorWithCode(e, ErrorCodes.GIT_ERROR)) throw e;
    console.warn(
      `${LOG_PREFIX.DONE} Warning: Could not check branch divergence: ${getErrorMessage(e)}`,
    );
  }
}

/**
 * Check for merge commits in lane branch that would violate linear history
 * WU-1384: GitHub requires linear history; merge commits in lane branches must be eliminated
 * WU-1371: Added wuId option for post-rebase artifact cleanup
 *
 * If merge commits are found, triggers auto-rebase to linearize history.
 *
 * @param {string} branch - Lane branch name
 * @param {CheckBranchOptions} [options] - Check options
 * @throws {Error} If merge commits found and auto-rebase fails or is disabled
 */
export async function checkMergeCommits(
  branch: string,
  options: CheckBranchOptions = {},
): Promise<void> {
  const { autoRebase = true, worktreePath = null, wuId = null } = options;
  const gitAdapter = getGitForCwd();

  try {
    // Find merge commits in lane branch that are not in main
    // --merges: only merge commits
    // main..branch: commits in branch not reachable from main
    const mergeCommitsRaw = await gitAdapter.raw([
      'rev-list',
      '--merges',
      `${BRANCHES.MAIN}..${branch}`,
    ]);

    const mergeCommits = mergeCommitsRaw.trim().split(STRING_LITERALS.NEWLINE).filter(Boolean);
    const mergeCount = mergeCommits.length;

    if (mergeCount > 0) {
      console.log(PREFLIGHT.MERGE_COMMITS_DETECTED(mergeCount));

      // Trigger rebase to eliminate merge commits
      if (autoRebase && worktreePath) {
        console.log(PREFLIGHT.MERGE_COMMITS_REBASING);
        const rebaseResult = await autoRebaseBranch(branch, worktreePath, wuId);
        if (rebaseResult.success) {
          // Rebase succeeded - merge commits eliminated
          return;
        }

        // Rebase failed - throw with detailed instructions
        throw createError(ErrorCodes.GIT_ERROR, rebaseResult.error ?? 'Auto-rebase failed', {
          branch,
          mergeCommitCount: mergeCount,
          autoRebaseAttempted: true,
        });
      }

      // Auto-rebase disabled or no worktree path - throw with manual instructions
      throw createError(
        ErrorCodes.GIT_ERROR,
        `Branch ${branch} contains ${mergeCount} merge commit(s).\n\n` +
          `GitHub requires linear history. Merge commits must be eliminated.\n\n` +
          `REQUIRED: Rebase your branch to linearize history:\n` +
          `  1. cd into your worktree\n` +
          `  2. git fetch ${REMOTES.ORIGIN} ${BRANCHES.MAIN}\n` +
          `  3. git rebase ${REMOTES.ORIGIN}/${BRANCHES.MAIN}\n` +
          `  4. git push --force-with-lease ${REMOTES.ORIGIN} ${branch}\n` +
          `  5. Return to main checkout and retry`,
        { branch, mergeCommitCount: mergeCount },
      );
    }

    console.log(PREFLIGHT.NO_MERGE_COMMITS);
  } catch (e: unknown) {
    if (isErrorWithCode(e, ErrorCodes.GIT_ERROR)) throw e;
    console.warn(
      `${LOG_PREFIX.DONE} Warning: Could not check for merge commits: ${getErrorMessage(e)}`,
    );
  }
}

/**
 * Check for merge conflicts using git merge-tree
 * WU-755 pre-flight check
 *
 * @param {string} branch - Lane branch name
 */
export async function checkMergeConflicts(branch: string): Promise<void> {
  const MERGE_TREE_CONFLICT_EXIT_CODE = 1;

  try {
    // Use git exit status for conflict detection (status=1 indicates conflicts).
    // This avoids brittle parsing of merge-tree output text.
    const result = spawnSync(
      GIT_COMMANDS.GIT,
      [GIT_COMMANDS.MERGE_TREE, GIT_FLAGS.WRITE_TREE, BRANCHES.MAIN, branch],
      {
        cwd: process.cwd(),
        encoding: 'utf-8',
      },
    );

    if (result.error) {
      console.warn(
        `${LOG_PREFIX.DONE} Warning: Could not check merge conflicts: ${result.error.message}`,
      );
      return;
    }

    if (result.status === 0) {
      console.log(PREFLIGHT.NO_CONFLICTS);
      return;
    }

    if (result.status === MERGE_TREE_CONFLICT_EXIT_CODE) {
      throw createError(
        ErrorCodes.GIT_ERROR,
        PREFLIGHT.CONFLICT_ERROR(REMOTES.ORIGIN, BRANCHES.MAIN),
        {
          branch,
          operation: 'merge-tree --write-tree',
        },
      );
    }

    const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
    const detail =
      stderr ||
      `${GIT_COMMANDS.GIT} ${GIT_COMMANDS.MERGE_TREE} exited with status ${String(result.status)}`;
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check merge conflicts: ${detail}`);
  } catch (e: unknown) {
    if (isErrorWithCode(e, ErrorCodes.GIT_ERROR)) throw e;
    const message = getErrorMessage(e);
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check merge conflicts: ${message}`);
  }
}

/**
 * WU-1456: Check for empty merge (no work commits beyond claim)
 * WU-1460: Upgraded to BLOCK when code_paths defined but files not modified
 *
 * Detects when an agent runs wu:done without committing actual work.
 * - If code_paths defined: BLOCK if those files weren't modified
 * - If no code_paths: WARNING only (docs-only or metadata updates are valid)
 *
 * @param {string} branch - Lane branch name
 * @param {object} [doc] - WU document with code_paths array (optional for backwards compatibility)
 * @returns {Promise<void>}
 * @throws {Error} When code_paths defined but files not modified in commits
 */
export async function checkEmptyMerge(
  branch: string,
  doc: { code_paths?: string[] } | null = null,
): Promise<void> {
  const gitAdapter = getGitForCwd();
  try {
    // Count commits on lane branch that are not in main
    const commitCountRaw = await gitAdapter.raw([
      'rev-list',
      '--count',
      `${BRANCHES.MAIN}..${branch}`,
    ]);
    const commitCount = Number(commitCountRaw.trim());

    // WU-1460: If code_paths defined, verify those files were modified
    const codePaths = Array.isArray(doc?.code_paths)
      ? doc.code_paths.filter((filePath): filePath is string => typeof filePath === 'string')
      : [];
    const hasCodePaths = codePaths.length > 0;

    if (hasCodePaths) {
      // Get list of files modified in lane branch commits
      const modifiedFilesRaw = await gitAdapter.raw([
        'diff',
        '--name-only',
        `${BRANCHES.MAIN}...${branch}`,
      ]);
      const modifiedFiles = modifiedFilesRaw.trim().split('\n').filter(Boolean);

      // Check if code_paths files are in the modified list
      const missingCodePaths = codePaths.filter(
        (codePath: string) =>
          !modifiedFiles.some(
            (modified: string) => modified.includes(codePath) || codePath.includes(modified),
          ),
      );

      if (missingCodePaths.length > 0) {
        // BLOCK: code_paths defined but files not modified
        throw createValidationError(PREFLIGHT.CODE_PATHS_NOT_MODIFIED(missingCodePaths), {
          branch,
          codePaths,
          missingCodePaths,
          modifiedFiles,
        });
      }

      // All code_paths files were modified
      console.log(PREFLIGHT.CODE_PATHS_VERIFIED);
    } else if (commitCount <= 1) {
      // No code_paths - just warn (backwards compatible behaviour)
      // If only 0-1 commits beyond main, this is likely the claim commit only
      console.log(PREFLIGHT.EMPTY_MERGE_WARNING(commitCount));
    } else {
      console.log(PREFLIGHT.EMPTY_MERGE_CHECK);
    }
  } catch (e: unknown) {
    // Re-throw validation errors (WU-1460 blocker)
    if (isErrorWithCode(e, ErrorCodes.VALIDATION_ERROR)) throw e;
    console.warn(
      `${LOG_PREFIX.DONE} Warning: Could not check for empty merge: ${getErrorMessage(e)}`,
    );
  }
}
