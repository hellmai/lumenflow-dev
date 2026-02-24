// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { createGitForPath, getGitForCwd } from './git-adapter.js';
import { createError, ErrorCodes } from './error-handler.js';
import {
  MAX_MERGE_RETRIES,
  cleanupMicroWorktree,
  cleanupOrphanedMicroWorktree,
  createMicroWorktreeDir,
  formatRetryExhaustionError,
  getTempBranchName,
  isRetryExhaustionError,
  pushRefspecWithRetry,
} from './micro-worktree-shared.js';
import { BRANCHES, GIT_REFS, REMOTES } from './wu-constants.js';
import type { GitAdapter } from './git-adapter.js';

export interface AtomicMergeCallbackContext {
  worktreePath: string;
  gitWorktree: GitAdapter;
  tempBranchName: string;
}

export interface WithAtomicMergeOptions {
  id: string;
  laneBranch: string;
  afterMerge?: (context: AtomicMergeCallbackContext) => Promise<void>;
  operation?: string;
  logPrefix?: string;
  mergeRetries?: number;
  command?: string;
}

export interface WithAtomicMergeResult {
  tempBranchName: string;
  worktreePath: string;
}

function buildMergeRetryExhaustionMessage(
  laneBranch: string,
  mergeRetries: number,
  command: string,
): string {
  return (
    `Atomic merge failed after ${mergeRetries} attempts while merging ${laneBranch}.\n\n` +
    `Next steps:\n` +
    `  1. Wait a few seconds and retry:\n` +
    `     ${command}\n` +
    `  2. If the issue persists, inspect branch divergence and rerun wu:prep\n` +
    `  3. Check if another agent is rapidly pushing to origin/main`
  );
}

async function mergeLaneBranchWithRetry(options: {
  mainGit: GitAdapter;
  gitWorktree: GitAdapter;
  laneBranch: string;
  mergeRetries: number;
  logPrefix: string;
  command: string;
}): Promise<void> {
  const { mainGit, gitWorktree, laneBranch, mergeRetries, logPrefix, command } = options;

  for (let attempt = 1; attempt <= mergeRetries; attempt++) {
    try {
      console.log(
        `${logPrefix} Merging ${laneBranch} in temp worktree (attempt ${attempt}/${mergeRetries})...`,
      );
      await gitWorktree.merge(laneBranch, { ffOnly: true });
      console.log(`${logPrefix} ✅ Temp-worktree merge succeeded`);
      return;
    } catch (error) {
      if (attempt >= mergeRetries) {
        throw createError(
          ErrorCodes.MERGE_EXHAUSTION,
          buildMergeRetryExhaustionMessage(laneBranch, mergeRetries, command),
        );
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`${logPrefix} ⚠️ Merge attempt failed: ${errorMessage}`);
      console.log(`${logPrefix} Fetching ${REMOTES.ORIGIN}/${BRANCHES.MAIN} before retry...`);
      await mainGit.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
      console.log(`${logPrefix} Rebasing temp branch onto ${GIT_REFS.ORIGIN_MAIN}...`);
      await gitWorktree.rebase(GIT_REFS.ORIGIN_MAIN);
    }
  }
}

export async function withAtomicMerge(
  options: WithAtomicMergeOptions,
): Promise<WithAtomicMergeResult> {
  const {
    id,
    laneBranch,
    afterMerge,
    operation = 'wu-done',
    logPrefix = '[wu-done]',
    mergeRetries = MAX_MERGE_RETRIES,
    command = `pnpm wu:done --id ${id}`,
  } = options;

  const mainGit = getGitForCwd();
  const tempBranchName = getTempBranchName(operation, id);
  const worktreePath = createMicroWorktreeDir(`${operation}-`);

  await cleanupOrphanedMicroWorktree(operation, id, mainGit, logPrefix);

  try {
    console.log(`${logPrefix} Fetching ${REMOTES.ORIGIN}/${BRANCHES.MAIN} before atomic merge...`);
    await mainGit.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);

    console.log(`${logPrefix} Creating temp branch: ${tempBranchName}`);
    await mainGit.createBranchNoCheckout(tempBranchName, GIT_REFS.ORIGIN_MAIN);

    console.log(`${logPrefix} Creating temp worktree: ${worktreePath}`);
    await mainGit.worktreeAddExisting(worktreePath, tempBranchName);

    const gitWorktree = createGitForPath(worktreePath);

    await mergeLaneBranchWithRetry({
      mainGit,
      gitWorktree,
      laneBranch,
      mergeRetries,
      logPrefix,
      command,
    });

    if (afterMerge) {
      await afterMerge({ worktreePath, gitWorktree, tempBranchName });
    }

    const pushDescription = `${operation} atomic merge push for ${id} (automated)`;
    await pushRefspecWithRetry(
      gitWorktree,
      mainGit,
      REMOTES.ORIGIN,
      tempBranchName,
      BRANCHES.MAIN,
      pushDescription,
      logPrefix,
    );

    try {
      console.log(`${logPrefix} Catching up local ${BRANCHES.MAIN} after atomic push...`);
      await mainGit.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
      await mainGit.merge(GIT_REFS.ORIGIN_MAIN, { ffOnly: true });
      console.log(`${logPrefix} ✅ Local ${BRANCHES.MAIN} caught up`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(
        `${logPrefix} ⚠️ Could not fast-forward local ${BRANCHES.MAIN}: ${errorMessage}`,
      );
    }

    return { tempBranchName, worktreePath };
  } catch (error) {
    if (error instanceof Error && isRetryExhaustionError(error)) {
      throw createError(
        ErrorCodes.RETRY_EXHAUSTION,
        formatRetryExhaustionError(error, { command }),
      );
    }
    throw error;
  } finally {
    await cleanupMicroWorktree(worktreePath, tempBranchName, logPrefix);
  }
}
