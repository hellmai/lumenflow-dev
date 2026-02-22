// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Zombie state detection and recovery for wu:done
 *
 * Extracted from wu-done-worktree.ts to isolate recovery orchestration.
 * Handles detection of "zombie" WUs (status=done in worktree but not merged)
 * and coordinates recovery: squash previous attempts, reset YAML, continue.
 *
 * Functions:
 *   handleZombieRecovery - Detect and recover from zombie WU state
 */

import { createGitForPath } from './git-adapter.js';
import { LOG_PREFIX, EMOJI, BOX } from './wu-constants.js';
import { RECOVERY } from './wu-done-messages.js';
import { createRecoveryError } from './wu-done-errors.js';
import {
  detectZombieState,
  resetWorktreeYAMLForRecovery,
  getRecoveryAttemptCount,
  incrementRecoveryAttempt,
  shouldEscalateToManualIntervention,
  MAX_RECOVERY_ATTEMPTS,
} from './wu-recovery.js';
import { prepareRecoveryWithSquash } from './wu-done-retry-helpers.js';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Handle zombie state detection and recovery.
 *
 * A "zombie" WU has status=done in the worktree YAML but was never
 * successfully merged to main. This function:
 * 1. Detects the zombie state
 * 2. Checks recovery attempt count to prevent infinite loops
 * 3. Squashes previous completion attempts
 * 4. Resets worktree YAML to in_progress for a fresh attempt
 *
 * @param doc - WU document (mutated in-place if recovery resets status)
 * @param worktreePath - Absolute path to the worktree
 * @param id - WU ID (e.g. 'WU-1234')
 * @returns true if zombie was detected and recovery initiated, false if no zombie
 * @throws When recovery loop detected (too many attempts)
 */
export async function handleZombieRecovery(
  doc: Record<string, unknown>,
  worktreePath: string,
  id: string,
): Promise<boolean> {
  if (!detectZombieState(doc, worktreePath)) {
    return false;
  }

  console.log(`\n${RECOVERY.DETECTED}`);

  // WU-1335: Check recovery attempt count to prevent infinite loops
  const attemptCount = getRecoveryAttemptCount(id);
  if (shouldEscalateToManualIntervention(attemptCount)) {
    console.log(`\n${BOX.TOP}`);
    console.log(`${BOX.SIDE}  RECOVERY LOOP DETECTED - MANUAL INTERVENTION REQUIRED`);
    console.log(BOX.MID);
    console.log(`${BOX.SIDE}  WU: ${id}`);
    console.log(`${BOX.SIDE}  Recovery attempts: ${attemptCount} (max: ${MAX_RECOVERY_ATTEMPTS})`);
    console.log(BOX.SIDE);
    console.log(`${BOX.SIDE}  Automatic recovery has failed multiple times.`);
    console.log(`${BOX.SIDE}  Manual steps required:`);
    console.log(BOX.SIDE);
    console.log(`${BOX.SIDE}  1. cd ${worktreePath}`);
    console.log(`${BOX.SIDE}  2. Reset WU YAML status to in_progress manually`);
    console.log(`${BOX.SIDE}  3. git add && git commit`);
    console.log(`${BOX.SIDE}  4. Return to main and retry wu:done`);
    console.log(BOX.SIDE);
    console.log(`${BOX.SIDE}  Or reset the recovery counter:`);
    console.log(`${BOX.SIDE}  rm .lumenflow/recovery/${id}.recovery`);
    console.log(BOX.BOT);

    throw createRecoveryError(
      `Recovery loop detected for ${id} after ${attemptCount} attempts. Manual intervention required.`,
      { wuId: id, attemptCount, maxAttempts: MAX_RECOVERY_ATTEMPTS },
    );
  }

  // Increment attempt counter before trying recovery
  const newAttemptCount = incrementRecoveryAttempt(id);
  console.log(
    `${LOG_PREFIX.DONE} Recovery attempt ${newAttemptCount}/${MAX_RECOVERY_ATTEMPTS} (WU-1335)`,
  );

  console.log(RECOVERY.RESUMING);

  // WU-1749: Squash previous completion attempts before recovery
  try {
    const gitWorktree = createGitForPath(worktreePath);
    const squashResult = await prepareRecoveryWithSquash(id, gitWorktree);
    if (squashResult.squashedCount > 0) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Squashed ${squashResult.squashedCount} previous completion attempt(s)`,
      );
    }
  } catch (squashError: unknown) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not squash previous attempts: ${getErrorMessage(squashError)}`,
    );
  }

  console.log(
    `${LOG_PREFIX.DONE} WU-1440: Resetting worktree YAML to in_progress for recovery flow...`,
  );

  // Reset the worktree YAML to in_progress (mutates doc)
  resetWorktreeYAMLForRecovery({ worktreePath, id, doc });

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Recovery reset complete - continuing normal flow`,
  );

  return true;
}
