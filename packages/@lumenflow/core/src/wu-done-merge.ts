// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Merge operations for wu:done worktree completion.
 *
 * Extracted from wu-done-worktree.ts to isolate merge-with-retry logic.
 * Rebase and conflict resolution live in wu-done-rebase.ts.
 *
 * Functions:
 *   isMainAncestorOfBranch - Check if main is an ancestor of a branch
 *   mergeLaneBranch        - Merge lane branch to main with retry
 */

import { getGitForCwd, type GitAdapter } from './git-adapter.js';
import { BRANCHES, REMOTES, LOG_PREFIX, EMOJI, GIT_COMMANDS, GIT_FLAGS } from './wu-constants.js';
import { MERGE } from './wu-done-messages.js';
import { createError, ErrorCodes } from './error-handler.js';
import { withRetry, createRetryConfig } from './retry-strategy.js';
import { autoRebaseBranch } from './wu-done-rebase.js';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Check if main is an ancestor of the given branch.
 *
 * @param gitAdapter - Git adapter instance
 * @param branch - Branch to check
 * @returns True if main is an ancestor of branch
 */
export async function isMainAncestorOfBranch(
  gitAdapter: GitAdapter,
  branch: string,
): Promise<boolean> {
  try {
    await gitAdapter.raw([GIT_COMMANDS.MERGE_BASE, GIT_FLAGS.IS_ANCESTOR, BRANCHES.MAIN, branch]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge options for mergeLaneBranch.
 * Fields mirror CheckBranchOptions (from wu-done-preflight-checks) plus retry config.
 * Defined inline to avoid circular dependency.
 */
export interface MergeLaneBranchOptions {
  /** Automatically rebase if diverged */
  autoRebase?: boolean;
  /** Path to worktree (required if autoRebase=true) */
  worktreePath?: string | null;
  /** WU ID for artifact cleanup (e.g., 'WU-1371') */
  wuId?: string | null;
  /** Override max retry attempts */
  maxAttempts?: number;
}

/**
 * Merge lane branch to main with exponential backoff retry (WU-1747)
 *
 * Uses retry strategy to handle concurrent completions gracefully.
 * WU-1749 Bug 2: Will auto-rebase lane branch onto new main on retry.
 *
 * @param branch - Lane branch name
 * @param options - Merge options
 * @throws On merge failure after all retries
 */
export async function mergeLaneBranch(
  branch: string,
  options: MergeLaneBranchOptions = {},
): Promise<void> {
  const gitAdapter = getGitForCwd();
  console.log(MERGE.BRANCH_MERGE(branch));

  // WU-1747: Use exponential backoff retry for merge operations
  // WU-1749 Bug 2: Now rebases lane branch on retry instead of just pulling main
  const retryConfig = createRetryConfig('wu_done', {
    maxAttempts: options.maxAttempts,
    onRetry: async (attempt: number, error: unknown, _delay: number) => {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Merge attempt ${attempt} failed: ${getErrorMessage(error)}`,
      );

      // WU-1749 Bug 2: Rebase lane branch onto new main instead of just pulling
      if (options.worktreePath) {
        const mainIsAncestor = await isMainAncestorOfBranch(gitAdapter, branch);
        if (mainIsAncestor) {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.INFO} Main is already an ancestor - skipping auto-rebase`,
          );
          return;
        }

        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.INFO} Auto-rebasing lane branch onto latest main...`,
        );
        const rebaseResult = await autoRebaseBranch(branch, options.worktreePath, options.wuId);
        if (rebaseResult.success) {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Lane branch rebased - ff-only merge should succeed`,
          );
        } else {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Auto-rebase failed: ${rebaseResult.error}`,
          );
          // Fall back to pull --rebase for consistent linear-history sync
          try {
            await gitAdapter.raw([
              GIT_COMMANDS.PULL,
              GIT_FLAGS.REBASE,
              '--autostash',
              REMOTES.ORIGIN,
              BRANCHES.MAIN,
            ]);
            console.log(MERGE.UPDATED_MAIN(REMOTES.ORIGIN));
          } catch (pullErr: unknown) {
            console.log(
              `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Pull also failed: ${getErrorMessage(pullErr)}`,
            );
          }
        }
      } else {
        // No worktree path - pull --rebase before retry
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.INFO} Pulling latest main with --rebase before retry...`,
        );
        try {
          await gitAdapter.raw([
            GIT_COMMANDS.PULL,
            GIT_FLAGS.REBASE,
            '--autostash',
            REMOTES.ORIGIN,
            BRANCHES.MAIN,
          ]);
          console.log(MERGE.UPDATED_MAIN(REMOTES.ORIGIN));
        } catch (pullErr: unknown) {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Pull failed: ${getErrorMessage(pullErr)} - will retry anyway`,
          );
        }
      }
    },
  });

  try {
    await withRetry(async () => {
      await gitAdapter.merge(branch, { ffOnly: true });
    }, retryConfig);

    console.log(MERGE.SUCCESS(branch));
  } catch (e: unknown) {
    // All retries exhausted
    const mainIsAncestor = await isMainAncestorOfBranch(gitAdapter, branch);
    const message = mainIsAncestor
      ? MERGE.FF_FAILED_NON_DIVERGED_ERROR(branch, getErrorMessage(e))
      : MERGE.FF_DIVERGED_ERROR(branch, getErrorMessage(e));
    throw createError(ErrorCodes.GIT_ERROR, message, {
      branch,
      originalError: getErrorMessage(e),
      retriesExhausted: true,
      mainIsAncestor,
    });
  }
}
