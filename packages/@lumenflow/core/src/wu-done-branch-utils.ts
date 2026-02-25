// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Branch utilities for wu:done workflows.
 */

import { getGitForCwd } from './git-adapter.js';
import { BRANCHES, LOG_PREFIX } from './wu-constants.js';
import { PREFLIGHT } from './wu-done-messages.js';

/** @constant {number} SHA_SHORT_LENGTH - Length of shortened git SHA hashes for display */
const SHA_SHORT_LENGTH = 8;

/**
 * Check if branch is already merged to main
 *
 * @param {string} branch - Lane branch name
 * @returns {Promise<boolean>} Whether branch is already merged
 */
export async function isBranchAlreadyMerged(branch: string) {
  const gitAdapter = getGitForCwd();
  try {
    const branchTip = (await gitAdapter.getCommitHash(branch)).trim();
    const mergeBase = (await gitAdapter.mergeBase(BRANCHES.MAIN, branch)).trim();
    const mainHead = (await gitAdapter.getCommitHash(BRANCHES.MAIN)).trim();

    if (branchTip === mergeBase) {
      console.log(
        PREFLIGHT.BRANCH_INFO(
          branch,
          branchTip.substring(0, SHA_SHORT_LENGTH),
          mergeBase.substring(0, SHA_SHORT_LENGTH),
          mainHead.substring(0, SHA_SHORT_LENGTH),
        ),
      );
      return true;
    }

    return false;
  } catch (e) {
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check if branch is merged: ${e.message}`);
    return false;
  }
}
