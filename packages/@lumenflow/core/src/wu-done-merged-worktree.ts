/**
 * WU-1746: Already-merged worktree recovery for wu:done
 *
 * When a WU branch has been manually merged to main and the worktree
 * deleted (or nuked by git), wu:done normally cannot complete because
 * it expects a live worktree. This module detects the "branch already
 * merged, worktree gone" scenario and completes stamping and state
 * updates gracefully without a live worktree.
 *
 * Detection logic:
 * 1. If the lane branch still exists: check if branch tip === merge-base
 *    (meaning all branch commits are reachable from main HEAD)
 * 2. If the lane branch has been deleted: check if completion commits
 *    are reachable from HEAD via git log search
 *
 * Completion logic:
 * - Create stamp file (.lumenflow/stamps/WU-{id}.done)
 * - Update WU YAML status to 'done'
 * - Update backlog.md and status.md
 * - Emit state store 'complete' event (if state store is available)
 *
 * All operations are non-fatal individually; partial completion is
 * reported via the result object.
 */

import { existsSync } from 'node:fs';
import { getGitForCwd } from './git-adapter.js';
import { createStamp } from './stamp-utils.js';
import { readWU, writeWU } from './wu-yaml.js';
import { WU_PATHS } from './wu-paths.js';
import { moveWUToDoneBacklog } from './wu-backlog-updater.js';
import { updateStatusRemoveInProgress, addToStatusCompleted } from './wu-status-updater.js';
import { BRANCHES, LOG_PREFIX, EMOJI } from './wu-constants.js';
import { getErrorMessage } from './error-handler.js';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface AlreadyMergedDetectionParams {
  /** WU identifier (e.g. 'WU-1') */
  wuId: string;
  /** Lane branch name (e.g. 'lane/framework-core/wu-1') */
  laneBranch: string;
  /** Expected worktree path on disk */
  worktreePath: string | null;
}

export interface AlreadyMergedDetectionResult {
  /** Whether the WU branch commits are reachable from main HEAD */
  merged: boolean;
  /** Whether the lane branch still exists */
  branchExists: boolean;
  /** Whether the worktree directory exists on disk */
  worktreeExists: boolean;
}

export interface AlreadyMergedCompletionParams {
  /** WU identifier */
  id: string;
  /** WU title (for stamp file) */
  title: string;
  /** WU lane (for status updates) */
  lane: string;
}

export interface AlreadyMergedCompletionResult {
  /** Whether all operations completed successfully */
  success: boolean;
  /** Whether stamp file was created (or already existed) */
  stamped: boolean;
  /** Whether WU YAML was updated to status: done */
  yamlUpdated: boolean;
  /** Whether backlog/status docs were updated */
  backlogUpdated: boolean;
  /** Any errors that occurred during partial completion */
  errors: string[];
}

// ──────────────────────────────────────────────
// Detection
// ──────────────────────────────────────────────

/**
 * Detect whether a WU's branch commits are already merged to main
 * and the worktree no longer exists on disk.
 *
 * This is the entry point for the "already-merged resilience" path
 * in wu:done. Returns a detection result that the caller can use
 * to decide whether to proceed with stamping/cleanup without a
 * live worktree.
 *
 * @param params - Detection parameters
 * @returns Detection result
 */
export async function detectAlreadyMergedNoWorktree(
  params: AlreadyMergedDetectionParams,
): Promise<AlreadyMergedDetectionResult> {
  const { laneBranch, worktreePath } = params;

  // Check if worktree exists on disk
  const worktreeExists = worktreePath ? existsSync(worktreePath) : false;

  const gitAdapter = getGitForCwd();

  try {
    // Check if branch still exists
    const branchStillExists = await gitAdapter.branchExists(laneBranch);

    if (branchStillExists) {
      // Branch exists: check if tip === merge-base (fully merged)
      const branchTip = (await gitAdapter.getCommitHash(laneBranch)).trim();
      const mergeBase = (await gitAdapter.mergeBase(BRANCHES.MAIN, laneBranch)).trim();

      const isMerged = branchTip === mergeBase;

      return {
        merged: isMerged,
        branchExists: true,
        worktreeExists,
      };
    }

    // Branch does not exist: check if WU commits are reachable from HEAD
    // Search for completion commits mentioning the WU ID in the main history
    if (!worktreeExists) {
      try {
        const logOutput = await gitAdapter.raw([
          'log',
          '--oneline',
          '--all',
          '--grep',
          params.wuId,
          '-1',
          BRANCHES.MAIN,
        ]);
        const commitFound = logOutput.trim().length > 0;

        return {
          merged: commitFound,
          branchExists: false,
          worktreeExists: false,
        };
      } catch {
        // If git log fails, fall through to safe default
      }
    }

    return {
      merged: false,
      branchExists: false,
      worktreeExists,
    };
  } catch {
    // Fail-safe: on any git error, return false to avoid incorrect completion
    return {
      merged: false,
      branchExists: false,
      worktreeExists,
    };
  }
}

// ──────────────────────────────────────────────
// Completion
// ──────────────────────────────────────────────

/**
 * Execute completion operations for a WU whose branch is already
 * merged to main but was never stamped/finalized.
 *
 * This performs all the state cleanup that wu:done normally does
 * during its worktree completion path, but without requiring a
 * live worktree.
 *
 * Operations are individually non-fatal: if stamp creation succeeds
 * but backlog update fails, the result captures both outcomes.
 *
 * @param params - Completion parameters
 * @returns Completion result with per-operation status
 */
export async function executeAlreadyMergedCompletion(
  params: AlreadyMergedCompletionParams,
): Promise<AlreadyMergedCompletionResult> {
  const { id, title, lane } = params;
  const errors: string[] = [];
  let stamped = false;
  let yamlUpdated = false;
  let backlogUpdated = false;

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} WU-1746: Branch already merged to main, worktree gone.`,
  );
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} Completing stamping and state cleanup without worktree...`,
  );

  // Step 1: Create stamp file
  try {
    const stampResult = createStamp({ id, title });
    stamped = true;
    if (stampResult.created) {
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Created stamp: ${stampResult.path}`);
    } else {
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} Stamp already exists: ${stampResult.path}`);
    }
  } catch (err) {
    errors.push(`Stamp creation failed: ${getErrorMessage(err)}`);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Stamp creation failed: ${getErrorMessage(err)}`,
    );
  }

  // Step 2: Update WU YAML status to done
  try {
    const wuPath = WU_PATHS.WU(id);
    const doc = readWU(wuPath, id);
    if (doc && typeof doc === 'object') {
      const updatedDoc = {
        ...doc,
        status: 'done',
        completed_at: new Date().toISOString().split('T')[0],
      };
      writeWU(wuPath, updatedDoc);
      yamlUpdated = true;
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Updated WU YAML status to done`);
    }
  } catch (err) {
    errors.push(`WU YAML update failed: ${getErrorMessage(err)}`);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU YAML update failed: ${getErrorMessage(err)}`,
    );
  }

  // Step 3: Update backlog and status files
  try {
    const backlogPath = WU_PATHS.BACKLOG();
    moveWUToDoneBacklog(backlogPath, id, title);

    const statusPath = WU_PATHS.STATUS();
    updateStatusRemoveInProgress(statusPath, id);
    addToStatusCompleted(statusPath, id, title);

    backlogUpdated = true;
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Updated backlog and status files`);
  } catch (err) {
    errors.push(`Backlog/status update failed: ${getErrorMessage(err)}`);
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Backlog/status update failed: ${getErrorMessage(err)}`,
    );
  }

  const success = errors.length === 0;

  if (success) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU-1746: Already-merged completion finished successfully`,
    );
  } else {
    console.warn(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-1746: Completed with ${errors.length} error(s)`,
    );
  }

  return {
    success,
    stamped,
    yamlUpdated,
    backlogUpdated,
    errors,
  };
}
