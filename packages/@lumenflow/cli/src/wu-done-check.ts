import { createGitForPath } from '@lumenflow/core/git-adapter';
import { die } from '@lumenflow/core/error-handler';
import { LOG_PREFIX } from '@lumenflow/core/wu-constants';

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
  try {
    const git = createGitForPath(worktreePath);
    const status = await git.getStatus();
    if (status.trim()) {
      die(
        `Worktree has uncommitted changes. Cannot proceed with wu:done.\n\n` +
          `Path: ${worktreePath}\n\n` +
          `Uncommitted changes:\n${status}\n\n` +
          `❌ BLOCKING: Uncommitted changes would be lost during auto-rebase.\n\n` +
          `Fix:\n` +
          `  1. cd worktrees/<lane>-wu-xxx\n` +
          `  2. git add . && git commit -m "wip: ..."\n` +
          `  3. Retry pnpm wu:done --id WU-XXXX`,
      );
    }
  } catch (err: unknown) {
    // If worktree is missing or git fails, let the flow continue (handled by other checks)
    const error = err instanceof Error ? err : new Error(String(err));
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check worktree status: ${error.message}`);
  }
}
