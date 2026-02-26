// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2014: Main branch sync validation for wu:done
 *
 * Extracted from wu-done-worktree.ts to isolate main-branch-behind-origin
 * detection into a focused module.
 *
 * Functions:
 *   validateMainNotBehindOrigin - Check if local main is behind origin/main
 *   ensureMainNotBehindOrigin   - Throws if local main is behind origin
 */

import { createGitForPath } from './git-adapter.js';
import { BRANCHES, REMOTES } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';
import type { ISyncValidatorGitAdapter } from './ports/sync-validator.ports.js';

type MainSyncGitAdapter = Pick<ISyncValidatorGitAdapter, 'fetch' | 'getCommitHash' | 'revList'>;

/**
 * WU-1577: Validate that local main is not behind origin/main before transaction.
 *
 * Defense-in-depth check inside the core layer. The CLI layer already has
 * `ensureMainUpToDate()`, but this adds a guard directly before the
 * transaction starts in `executeWorktreeCompletion()`.
 *
 * Fail-open: if the fetch or comparison fails (network issue), returns valid=true
 * to avoid blocking legitimate work when there's no remote.
 */
export async function validateMainNotBehindOrigin(
  gitAdapter: MainSyncGitAdapter,
): Promise<{ valid: boolean; commitsBehind: number; failOpen?: boolean }> {
  try {
    await gitAdapter.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);

    const localSha = await gitAdapter.getCommitHash(BRANCHES.MAIN);
    const remoteSha = await gitAdapter.getCommitHash(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);

    if (localSha === remoteSha) {
      return { valid: true, commitsBehind: 0 };
    }

    const behindRaw = await gitAdapter.revList([
      '--count',
      `${BRANCHES.MAIN}..${REMOTES.ORIGIN}/${BRANCHES.MAIN}`,
    ]);
    const commitsBehind = Number(behindRaw.trim()) || 0;

    if (commitsBehind > 0) {
      return { valid: false, commitsBehind };
    }

    return { valid: true, commitsBehind: 0 };
  } catch {
    return { valid: true, commitsBehind: 0, failOpen: true };
  }
}

/**
 * WU-1577: Helper that throws if local main is behind origin.
 *
 * Used as a pre-flight guard before starting the wu:done transaction.
 *
 * @param mainCheckoutPath - Absolute path to the main checkout
 * @param wuId - WU ID for error messages
 * @throws When local main is behind origin/main
 */
export async function ensureMainNotBehindOrigin(
  mainCheckoutPath: string,
  wuId: string,
): Promise<void> {
  const gitMainPreCheck = createGitForPath(mainCheckoutPath);
  const result = await validateMainNotBehindOrigin(gitMainPreCheck);
  if (!result.valid) {
    throw createError(
      ErrorCodes.GIT_ERROR,
      `Local main is ${result.commitsBehind} commit(s) behind origin/main.\n\n` +
        `wu:done aborted BEFORE file writes to prevent metadata leaks (WU-1577).\n\n` +
        `Fix: git pull origin main\n` +
        `Then retry: pnpm wu:done --id ${wuId}`,
      { wuId, commitsBehind: result.commitsBehind },
    );
  }
}
