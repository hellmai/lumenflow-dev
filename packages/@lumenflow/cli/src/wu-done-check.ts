// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { createGitForPath } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { LOG_PREFIX, LUMENFLOW_PATHS } from '@lumenflow/core/wu-constants';

const WU_DONE_ALLOWLISTED_STATUS_PATHS = new Set([LUMENFLOW_PATHS.WU_EVENTS]);

function extractStatusPath(statusLine: string): string {
  const match = statusLine.match(/^\s*[A-Z?!]{1,2}\s+(.*)$/);
  const rawPath = match?.[1]?.trim() ?? '';
  if (!rawPath) {
    return '';
  }

  const renameParts = rawPath.split(' -> ');
  return renameParts[renameParts.length - 1]?.trim() ?? '';
}

export function getBlockingWorktreeStatusLines(status: string): string[] {
  return status
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .filter((line) => !WU_DONE_ALLOWLISTED_STATUS_PATHS.has(extractStatusPath(line)));
}

/**
 * WU-1169: Ensure worktree is clean before wu:done operations.
 *
 * Prevents WU-1943 rollback loops where uncommitted changes in the worktree
 * cause auto-rebase to fail, triggering an expensive restoration that wipes
 * the uncommitted changes.
 *
 * This check HALTS wu:done immediately if the worktree is dirty.
 *
 * @param {string} worktreePath - Absolute path to the worktree
 */
export async function ensureCleanWorktree(worktreePath: string) {
  const git = createGitForPath(worktreePath);
  let status: string;

  try {
    status = await git.getStatus();
  } catch (err: unknown) {
    // If worktree is missing or git fails, let the flow continue (handled by other checks)
    const error = err instanceof Error ? err : new Error(String(err));
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check worktree status: ${error.message}`);
    return;
  }

  const blockingStatusLines = getBlockingWorktreeStatusLines(status);
  if (blockingStatusLines.length > 0) {
    die(
      `Worktree has uncommitted changes. Cannot proceed with wu:done.\n\n` +
        `Path: ${worktreePath}\n\n` +
        `Uncommitted changes:\n${blockingStatusLines.join('\n')}\n\n` +
        `❌ BLOCKING: Uncommitted changes would be lost during auto-rebase.\n\n` +
        `Fix:\n` +
        `  1. cd worktrees/<lane>-wu-xxx\n` +
        `  2. git add . && git commit -m "wip: ..."\n` +
        `  3. Retry pnpm wu:done --id WU-XXXX`,
    );
  }
}
