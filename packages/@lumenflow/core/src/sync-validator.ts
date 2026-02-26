// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Canonical sync validation helpers shared by WU helpers and wu:done.
 */

import { createGitForPath } from './git-adapter.js';
import { BRANCHES, REMOTES } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';
import type { ISyncValidatorGitAdapter } from './ports/sync-validator.ports.js';

export type EnsureMainUpToDateGitAdapter = Pick<ISyncValidatorGitAdapter, 'fetch' | 'getCommitHash'>;
export type MainSyncGitAdapter = Pick<
  ISyncValidatorGitAdapter,
  'fetch' | 'getCommitHash' | 'revList'
>;
export interface EnsureMainNotBehindOriginOptions {
  gitAdapterForMain?: MainSyncGitAdapter;
}

/**
 * Ensure main branch is up to date with origin.
 *
 * @param git - Git adapter with async fetch() and getCommitHash() methods
 * @param _scriptName - Script name for logging (reserved for compatibility)
 * @param options - Options
 * @param options.skipRemote - Skip remote check (requireRemote=false)
 * @throws If main is out of sync with origin
 */
export async function ensureMainUpToDate(
  git: EnsureMainUpToDateGitAdapter,
  _scriptName = 'wu',
  { skipRemote = false }: { skipRemote?: boolean } = {},
): Promise<void> {
  if (skipRemote) return;
  await git.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
  const localMain = await git.getCommitHash(BRANCHES.MAIN);
  const remoteMain = await git.getCommitHash(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);
  if (localMain !== remoteMain) {
    throw createError(
      ErrorCodes.BRANCH_ERROR,
      `Main branch is out of sync with origin.\n\nRun: git pull ${REMOTES.ORIGIN} ${BRANCHES.MAIN}`,
    );
  }
}

/**
 * Validate that local main is not behind origin/main before transaction.
 *
 * Fail-open: if fetch or comparison fails (e.g., network issue), returns valid=true.
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
 * Throw when local main is behind origin/main.
 *
 * @param mainCheckoutPath - Absolute path to the main checkout
 * @param wuId - WU ID for error messages
 */
export async function ensureMainNotBehindOrigin(
  mainCheckoutPath: string,
  wuId: string,
  options: EnsureMainNotBehindOriginOptions = {},
): Promise<void> {
  const gitMainPreCheck = options.gitAdapterForMain ?? createGitForPath(mainCheckoutPath);
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
