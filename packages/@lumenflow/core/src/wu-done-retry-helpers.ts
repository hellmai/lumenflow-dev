// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-1584: Retry and recovery helpers for wu:done
 *
 * Handles:
 * - Squashing duplicate completion commits from retry attempts
 * - Detecting and counting previous completion attempts
 * - Preparing zombie recovery with squash
 * - Handling parallel completions with auto-rebase
 *
 * @module wu-done-retry-helpers
 */

import {
  LOG_PREFIX,
  EMOJI,
  GIT,
  GIT_COMMANDS,
  GIT_FLAGS,
  GIT_REFS,
  STRING_LITERALS,
} from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

/** Git adapter contract for retry helpers.
 *  Methods are individually optional to support partial adapter objects
 *  (e.g. CommitTransactionInput.worktreeGit). Callers must ensure
 *  the methods used at their call site are present. */
interface RetryHelperGitAdapter {
  log?(options?: {
    maxCount?: number;
  }): Promise<{ all?: ReadonlyArray<{ message: string }> } | null>;
  getStatus?(): Promise<string>;
  raw?(args: string[]): Promise<string>;
  fetch?(): Promise<void>;
  getCommitHash?(ref: string): Promise<string>;
  rebase?(onto: string): Promise<void>;
}

/** Minimal WU document shape needed by handleParallelCompletions */
interface WuDocForParallel {
  baseline_main_sha?: string;
}

/**
 * Regex to match wu:done completion commit messages
 * Format: wu(<id>): done - <title>
 *
 * Note: Does not use ^ anchor to allow matching within git log --oneline output
 * which includes commit hash prefix: "abc1234 wu(wu-500): done - title"
 *
 * @constant {RegExp}
 */
const COMPLETION_COMMIT_PATTERN = /wu\(([^)]+)\):\s*done\s*-/i;

/**
 * Count previous completion attempt commits for a WU on the current branch
 *
 * WU-1584 Fix #1: Detect duplicate commits from retries
 *
 * Searches commit history for commits matching the completion pattern
 * for the specified WU ID.
 *
 * @param {string} wuId - WU ID (e.g., 'WU-1584')
 * @param {object} gitAdapter - Git adapter instance
 * @returns {Promise<number>} Number of completion attempt commits found
 */
export async function countPreviousCompletionAttempts(
  wuId: string,
  gitAdapter: RetryHelperGitAdapter,
) {
  const normalizedId = wuId.toLowerCase();

  try {
    // Get recent commit history (limit to reasonable amount)
    const log = await gitAdapter.log?.({ maxCount: GIT.LOG_MAX_COUNT });

    if (!log || !log.all) {
      return 0;
    }

    // Count trailing completion attempts on the branch tip only.
    // This avoids accidentally squashing unrelated commits if the history contains
    // older completion commits that are not part of the current retry chain.
    let trailingCount = 0;
    for (const commit of log.all) {
      const match = commit.message.match(COMPLETION_COMMIT_PATTERN);
      if (!match) break;

      const commitWuId = match[1]?.toLowerCase();
      if (commitWuId !== normalizedId) break;

      trailingCount += 1;
    }

    return trailingCount;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not count previous attempts: ${message}`,
    );
    return 0;
  }
}

/**
 * Squash previous completion attempt commits into a single commit
 *
 * WU-1584 Fix #1: Running wu:done N times should result in exactly 1 completion commit
 *
 * Uses git reset --soft to combine multiple completion attempts while
 * preserving the staged changes for the new completion commit.
 *
 * @param {string} wuId - WU ID for logging
 * @param {number} count - Number of commits to squash
 * @param {object} gitAdapter - Git adapter instance
 * @param {SquashCompletionAttemptsOptions} [options] - Options
 * @returns {Promise<{ squashed: boolean, count: number }>} Result
 */
export interface SquashCompletionAttemptsOptions {
  /** Use --soft when true; --hard when false (recovery) */
  preserveIndex?: boolean;
}

export async function squashPreviousCompletionAttempts(
  wuId: string,
  count: number,
  gitAdapter: RetryHelperGitAdapter,
  options: SquashCompletionAttemptsOptions = {},
) {
  const { preserveIndex = true } = options;

  if (count === 0) {
    return { squashed: false, count: 0 };
  }

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Detected ${count} previous completion attempt commit(s)`,
  );
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} Squashing previous attempts to avoid duplicate commits...`,
  );

  try {
    // In the normal retry flow we need to preserve the staged metadata transaction,
    // so we use --soft (index/working tree unchanged).
    //
    // In zombie recovery we want to drop prior completion commits cleanly and start
    // from a known-good state, so we use --hard (index/working tree reset).
    if (!preserveIndex) {
      const status = (await gitAdapter.getStatus?.())?.trim?.() ?? '';
      if (status) {
        throw createError(
          ErrorCodes.RECOVERY_ERROR,
          `Cannot squash previous attempts: worktree has uncommitted changes.${STRING_LITERALS.NEWLINE}${STRING_LITERALS.NEWLINE}` +
            `Fix: In your worktree, run:${STRING_LITERALS.NEWLINE}` +
            `  ${GIT_COMMANDS.GIT} status${STRING_LITERALS.NEWLINE}` +
            `  ${GIT_COMMANDS.GIT} restore -SW .${STRING_LITERALS.NEWLINE}` +
            `Then retry wu:done.${STRING_LITERALS.NEWLINE}`,
          { wuId, count, preserveIndex, status },
        );
      }
    }

    const resetMode = preserveIndex ? GIT_FLAGS.SOFT : GIT_FLAGS.HARD;
    const headBackRef = `${GIT_REFS.HEAD}~${count}`;
    await gitAdapter.raw?.([GIT_COMMANDS.RESET, resetMode, headBackRef]);

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Squashed ${count} previous attempt(s) - will create single completion commit`,
    );

    return { squashed: true, count };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not squash previous attempts: ${message}`,
    );
    return { squashed: false, count: 0 };
  }
}

/**
 * Prepare zombie recovery with squash of previous attempts
 *
 * WU-1584 Fix #2: Recovery loop should squash previous attempt commits
 *
 * When recovering from zombie state (status=done but worktree exists),
 * first squash any previous completion attempts to avoid "rebase hell".
 *
 * @param {string} wuId - WU ID
 * @param {object} gitAdapter - Git adapter instance
 * @returns {Promise<{ squashedCount: number }>} Result
 */
export async function prepareRecoveryWithSquash(wuId: string, gitAdapter: RetryHelperGitAdapter) {
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} Checking for previous completion attempts before recovery...`,
  );

  const previousCount = await countPreviousCompletionAttempts(wuId, gitAdapter);

  if (previousCount > 0) {
    console.log(
      `${LOG_PREFIX.DONE} Squashing ${previousCount} previous completion attempt(s) for clean recovery`,
    );

    // Recovery: do not preserve index; reset to a clean state before continuing.
    const result = await squashPreviousCompletionAttempts(wuId, previousCount, gitAdapter, {
      preserveIndex: false,
    });

    return { squashedCount: result.squashed ? result.count : 0 };
  }

  return { squashedCount: 0 };
}

/**
 * Handle parallel completions with auto-rebase
 *
 * WU-1584 Fix #3: detectParallelCompletions() should trigger rebase, not just warn
 *
 * When parallel completions are detected (main has advanced since claim),
 * triggers auto-rebase instead of proceeding with merge that will fail.
 *
 * @param {string} wuId - WU ID
 * @param {object} doc - WU YAML document containing baseline_main_sha
 * @param {object} gitAdapter - Git adapter instance
 * @param {HandleParallelCompletionsOptions} options - Options
 * @returns {Promise<{ parallelDetected: boolean, rebaseTriggered: boolean }>}
 */
export interface HandleParallelCompletionsOptions {
  /** Path to worktree */
  worktreePath?: string;
  /** Whether auto-rebase is enabled (default: true) */
  autoRebase?: boolean;
}

export async function handleParallelCompletions(
  wuId: string,
  doc: WuDocForParallel,
  gitAdapter: RetryHelperGitAdapter,
  options: HandleParallelCompletionsOptions = {},
) {
  const { worktreePath, autoRebase = true } = options;

  // Fetch latest from origin
  await gitAdapter.fetch?.();

  // Get current origin/main SHA
  const currentMainSha = await gitAdapter.getCommitHash?.(GIT_REFS.ORIGIN_MAIN);

  // Get baseline SHA from when WU was claimed
  const baselineSha = doc.baseline_main_sha;

  if (!baselineSha || currentMainSha === baselineSha) {
    // No parallel completions - main hasn't changed since claim
    return { parallelDetected: false, rebaseTriggered: false };
  }

  // Check if changes since baseline include other WU completions
  const newCommits = await gitAdapter.raw?.([
    'log',
    '--oneline',
    `${baselineSha}..${GIT_REFS.ORIGIN_MAIN}`,
    '--',
  ]);

  const hasParallelCompletions =
    newCommits && newCommits.trim() && COMPLETION_COMMIT_PATTERN.test(newCommits);

  if (!hasParallelCompletions) {
    // Changes exist but are not WU completions - proceed normally
    return { parallelDetected: false, rebaseTriggered: false };
  }

  // Parallel completions detected
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Parallel completion(s) detected on main since WU claim`,
  );

  if (!autoRebase) {
    throw createError(
      ErrorCodes.VALIDATION_ERROR,
      `Parallel completions detected on main since ${wuId} was claimed.\n` +
        `This would cause merge conflicts during wu:done.\n\n` +
        `Fix: Run 'git fetch origin && git rebase ${GIT_REFS.ORIGIN_MAIN}' in your worktree,\n` +
        `then retry wu:done.\n\n` +
        `Or use --no-auto-rebase to disable this check (not recommended).`,
      { wuId, baselineSha, currentMainSha },
    );
  }

  // Trigger auto-rebase
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} Triggering auto-rebase to incorporate parallel completions...`,
  );

  try {
    // Rebase the current branch onto origin/main
    await gitAdapter.rebase?.(GIT_REFS.ORIGIN_MAIN);

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Auto-rebase complete - parallel completions incorporated`,
    );

    return { parallelDetected: true, rebaseTriggered: true };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw createError(
      ErrorCodes.GIT_ERROR,
      `Auto-rebase failed: ${errorMessage}\n\n` +
        `Manual resolution required:\n` +
        `1. cd ${worktreePath || 'your-worktree'}\n` +
        `2. git fetch origin && git rebase ${GIT_REFS.ORIGIN_MAIN}\n` +
        `3. Resolve conflicts if any\n` +
        `4. Retry wu:done`,
      { wuId, originalError: errorMessage },
    );
  }
}
