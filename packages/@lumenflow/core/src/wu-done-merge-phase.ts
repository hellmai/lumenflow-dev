// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Merge/PR decision phase for wu:done worktree completion.
 *
 * Extracted from wu-done-worktree.ts to isolate the merge-vs-PR decision tree.
 * After metadata is committed in the worktree, this module decides whether to:
 * 1. Create a PR (pr-mode)
 * 2. Run pre-flight checks and auto-merge (default mode)
 * 3. Skip merge entirely (noMerge flag)
 *
 * Functions:
 *   executeMergePhase - Run the merge/PR decision logic after worktree commit
 */

import { BRANCHES, REMOTES, THRESHOLDS, LOG_PREFIX, BOX } from './wu-constants.js';
import { PREFLIGHT, MERGE } from './wu-done-messages.js';
import { getDriftLevel, DRIFT_LEVELS } from './branch-drift.js';
import { createError, ErrorCodes } from './error-handler.js';
import { isPRModeEnabled, createPR, printPRCreatedMessage } from './wu-done-pr.js';
import { isBranchAlreadyMerged } from './wu-done-branch-utils.js';
import { branchExists } from './wu-done-validators.js';
import { withMergeLock } from './merge-lock.js';
import { withAtomicMerge } from './atomic-merge.js';
import {
  checkBranchDrift,
  checkBranchDivergence,
  checkMergeCommits,
  checkMergeConflicts,
  checkEmptyMerge,
} from './wu-done-preflight-checks.js';

/**
 * Input context for the merge phase.
 */
export interface MergePhaseContext {
  /** WU ID */
  id: string;
  /** WU title */
  title: string;
  /** Lane branch name (null if not resolvable) */
  laneBranch: string | null;
  /** WU doc from main checkout */
  docMain: Record<string, unknown>;
  /** WU doc being updated (for code_paths check) */
  docForUpdate: Record<string, unknown>;
  /** Done command args */
  args: {
    noMerge?: boolean;
    prDraft?: boolean;
    noAutoRebase?: boolean;
    [key: string]: unknown;
  };
  /** Worktree path (for rebase context) */
  worktreePath: string;
}

/**
 * Result of the merge phase.
 */
export interface MergePhaseResult {
  /** Whether a merge was performed */
  merged: boolean;
  /** PR URL if PR was created */
  prUrl: string | null;
  /** Whether PR mode was used */
  prModeEnabled: boolean;
}

/**
 * Execute the merge/PR decision phase.
 *
 * After metadata is committed in the worktree, this function:
 * - In PR mode: creates a pull request
 * - In default mode: runs pre-flight checks and auto-merges
 * - Throws if the lane branch is not found
 *
 * @param ctx - Merge phase context
 * @returns Merge phase result
 * @throws On lane branch not found or merge failure
 */
export async function executeMergePhase(ctx: MergePhaseContext): Promise<MergePhaseResult> {
  const { id, title, laneBranch, docMain, docForUpdate, args, worktreePath } = ctx;

  const prModeEnabled = isPRModeEnabled(docMain, args);
  let merged = false;
  let prUrl: string | null = null;

  if (args.noMerge) {
    return { merged: false, prUrl: null, prModeEnabled };
  }

  if (!laneBranch || !(await branchExists(laneBranch))) {
    console.error(`\n${BOX.TOP}`);
    console.error(`${BOX.SIDE}  MERGE FAILED: Lane branch not found`);
    console.error(BOX.MID);
    console.error(`${BOX.SIDE}  Expected branch: ${laneBranch || '(null)'}`);
    console.error(`${BOX.SIDE}  WU lane: "${docForUpdate.lane}"`);
    console.error(`${BOX.SIDE}  WU id: "${docForUpdate.id}"`);
    console.error(BOX.BOT);
    throw createError(ErrorCodes.BRANCH_ERROR, `Lane branch not found: ${laneBranch}`, {
      laneBranch,
      wuId: docForUpdate.id,
    });
  }

  if (prModeEnabled) {
    const prResult = await createPR({
      branch: laneBranch,
      id,
      title,
      doc: docMain,
      draft: args.prDraft,
    });
    if (prResult.success && prResult.prUrl) {
      printPRCreatedMessage(prResult.prUrl, id);
      prUrl = prResult.prUrl;
    }
  } else {
    // Default mode: Auto-merge with pre-flight checks
    console.log(PREFLIGHT.RUNNING);

    const commitsBehind = await checkBranchDrift(laneBranch);
    if (commitsBehind > 0) {
      const driftLevel = getDriftLevel(commitsBehind);
      if (driftLevel === DRIFT_LEVELS.WARNING) {
        console.log(PREFLIGHT.BRANCH_DRIFT_WARNING(commitsBehind));
      } else if (driftLevel === DRIFT_LEVELS.INFO) {
        console.log(PREFLIGHT.BRANCH_DRIFT_INFO(commitsBehind));
      } else if (driftLevel === DRIFT_LEVELS.OK) {
        console.log(PREFLIGHT.BRANCH_BEHIND(commitsBehind, THRESHOLDS.BRANCH_DRIFT_MAX));
      }
    }

    const alreadyMerged = await isBranchAlreadyMerged(laneBranch);
    if (alreadyMerged) {
      console.log(PREFLIGHT.ALREADY_MERGED);
      console.log(PREFLIGHT.ALREADY_MERGED_EXPLANATION);
    } else {
      await checkBranchDivergence(laneBranch, {
        autoRebase: args.noAutoRebase !== true,
        worktreePath,
        wuId: id,
      });

      await checkMergeCommits(laneBranch, {
        autoRebase: args.noAutoRebase !== true,
        worktreePath,
        wuId: id,
      });

      await checkMergeConflicts(laneBranch);

      await checkEmptyMerge(laneBranch, docForUpdate);

      console.log(MERGE.STARTING(laneBranch));
      await withMergeLock(id, async () => {
        await withAtomicMerge({
          id,
          laneBranch,
          command: `pnpm wu:done --id ${id}`,
          logPrefix: LOG_PREFIX.DONE,
        });
      });
      console.log(MERGE.ATOMIC_SUCCESS);
      merged = true;
      console.log(MERGE.PUSHED(REMOTES.ORIGIN, BRANCHES.MAIN));
    }
  }

  return { merged, prUrl, prModeEnabled };
}
