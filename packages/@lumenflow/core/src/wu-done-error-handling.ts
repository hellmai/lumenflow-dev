// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Error handling and rollback for wu:done worktree completion.
 *
 * Extracted from wu-done-worktree.ts to isolate error recovery orchestration.
 * Handles transaction rollback, git branch rollback, and user-facing error messages.
 *
 * Functions:
 *   handleCompletionError - Orchestrate error recovery after failed completion
 */

import { createGitForPath } from './git-adapter.js';
import { LOG_PREFIX, EMOJI, BOX } from './wu-constants.js';
import { restoreFromSnapshot, WUTransaction } from './wu-transaction.js';
import { rollbackBranchOnMergeFailure } from './wu-done-utils.js';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface ErrorWithCode extends Error {
  code?: string;
  cleanupSafe?: boolean;
}

/**
 * Context required for error handling after a failed completion attempt.
 */
export interface CompletionErrorContext {
  /** The caught error */
  error: unknown;
  /** WU ID */
  id: string;
  /** Path to the worktree */
  worktreePath: string;
  /** The transaction object */
  transaction: WUTransaction;
  /** Whether a git commit was made in the worktree */
  gitCommitMade: boolean;
  /** SHA before the metadata commit (for rollback) */
  preCommitSha: string | null;
  /** Transaction file snapshot for rollback */
  transactionSnapshot: Map<string, string | null> | null;
}

/**
 * Orchestrate error recovery after a failed wu:done completion attempt.
 *
 * Handles two distinct failure scenarios:
 * 1. Pre-commit failure: Transaction was not committed, abort cleanly
 * 2. Post-commit failure: Transaction was committed but merge failed,
 *    attempt file rollback and/or branch rollback
 *
 * Always prints user-facing error box with next steps.
 *
 * @param ctx - Error context with all state needed for recovery
 * @throws Always re-throws the original error with cleanupSafe=false
 */
export async function handleCompletionError(ctx: CompletionErrorContext): Promise<never> {
  const { error, id, worktreePath, transaction, gitCommitMade, preCommitSha, transactionSnapshot } =
    ctx;

  const worktreeError: ErrorWithCode =
    error instanceof Error ? (error as ErrorWithCode) : new Error(String(error));

  const wasCommitted = transaction.isCommitted;

  if (!wasCommitted) {
    transaction.abort();
    console.log(`\n${BOX.TOP}`);
    console.log(`${BOX.SIDE}  WU:DONE FAILED - NO FILES MODIFIED (atomic pattern)`);
    console.log(BOX.MID);
    console.log(`${BOX.SIDE}  Error: ${worktreeError.message}`);
    console.log(BOX.SIDE);
    console.log(`${BOX.SIDE}  WU-1369: Transaction aborted before file writes.`);
    console.log(`${BOX.SIDE}  WU-1811: Worktree preserved for recovery.`);
    console.log(`${BOX.SIDE}  Worktree: ${worktreePath}`);
    console.log(BOX.MID);
    console.log(`${BOX.SIDE}  NEXT STEP: Fix the error and rerun:`);
    console.log(`${BOX.SIDE}    pnpm wu:done --id ${id}`);
    console.log(BOX.BOT);
  } else {
    let fileRollbackSuccess = false;
    if (!gitCommitMade && transactionSnapshot) {
      console.log(
        `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-2310: Git commit failed after transaction - rolling back files...`,
      );
      try {
        const rollbackResult = restoreFromSnapshot(transactionSnapshot);
        if (rollbackResult.errors.length === 0) {
          fileRollbackSuccess = true;
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU-2310: File rollback complete - ${rollbackResult.restored.length} files restored`,
          );
        } else {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-2310: Partial file rollback - ${rollbackResult.restored.length} restored, ${rollbackResult.errors.length} failed`,
          );
          for (const e of rollbackResult.errors) {
            console.log(`${LOG_PREFIX.DONE}   ${EMOJI.FAILURE} ${e.path}: ${e.error}`);
          }
        }
      } catch (rollbackErr: unknown) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-2310: File rollback error: ${getErrorMessage(rollbackErr)}`,
        );
      }
    }

    if (gitCommitMade && preCommitSha) {
      console.log(
        `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} Merge failed after git commit - attempting branch rollback...`,
      );
      try {
        const gitWorktreeForRollback = createGitForPath(worktreePath);
        await rollbackBranchOnMergeFailure(gitWorktreeForRollback, preCommitSha, id);
      } catch (rollbackErr: unknown) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Rollback error: ${getErrorMessage(rollbackErr)}`,
        );
      }
    }

    console.log(`\n${BOX.TOP}`);
    if (fileRollbackSuccess) {
      console.log(`${BOX.SIDE}  WU:DONE FAILED - FILES ROLLED BACK (WU-2310)`);
      console.log(BOX.MID);
      console.log(`${BOX.SIDE}  Error: ${worktreeError.message}`);
      console.log(BOX.SIDE);
      console.log(`${BOX.SIDE}  WU-2310: Transaction files were rolled back to pre-commit state.`);
      console.log(`${BOX.SIDE}  Worktree is now consistent (status=in_progress, no stamp).`);
    } else {
      console.log(`${BOX.SIDE}  WU:DONE FAILED - PARTIAL STATE (post-transaction)`);
      console.log(BOX.MID);
      console.log(`${BOX.SIDE}  Error: ${worktreeError.message}`);
      console.log(BOX.SIDE);
      console.log(`${BOX.SIDE}  Metadata files were written, but git operations failed.`);
      if (gitCommitMade && preCommitSha) {
        console.log(`${BOX.SIDE}  WU-1943: Branch rolled back to pre-commit state.`);
      }
    }
    console.log(`${BOX.SIDE}  WU-1811: Worktree preserved for recovery.`);
    console.log(`${BOX.SIDE}  Worktree: ${worktreePath}`);
    console.log(BOX.MID);
    console.log(`${BOX.SIDE}  NEXT STEP: Rerun wu:done (idempotent recovery):`);
    console.log(`${BOX.SIDE}    pnpm wu:done --id ${id}`);
    console.log(BOX.BOT);
  }

  worktreeError.cleanupSafe = false;
  throw worktreeError;
}
