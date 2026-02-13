/**
 * Cleanup helpers for wu:done.
 */

import { existsSync } from 'node:fs';
import { getGitForCwd } from './git-adapter.js';
import { withCleanupLock } from './cleanup-lock.js';
import { validateWorktreeOwnership } from './worktree-ownership.js';
import { getCleanupInstallConfig, CLEANUP_INSTALL_TIMEOUT_MS } from './cleanup-install-config.js';
import { createValidationError } from './wu-done-errors.js';
import { defaultWorktreeFrom, defaultBranchFrom, branchExists } from './wu-done-paths.js';
import { isBranchAlreadyMerged } from './wu-done-branch-utils.js';
import { BRANCHES, CLAIMED_MODES, EMOJI, LOG_PREFIX, REMOTES } from './wu-constants.js';
import { exec as execCallback } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(execCallback);

/**
 * Run cleanup operations after successful merge
 * Removes worktree and optionally deletes lane branch
 */
export async function runCleanup(docMain, args) {
  const wuId = docMain.id;
  const worktreePath = args.worktree || (await defaultWorktreeFrom(docMain));

  // WU-2278: Validate worktree ownership before cleanup
  // Prevents cross-agent worktree deletion
  if (!args.overrideOwner) {
    const ownershipResult = validateWorktreeOwnership({ worktreePath, wuId });
    if (!ownershipResult.valid) {
      throw createValidationError(
        `${ownershipResult.error}\n\nTo override (DANGEROUS): pnpm wu:done --id ${wuId} --override-owner --reason "explanation"`,
        { wuId, worktreePath, error: ownershipResult.error },
      );
    }
  }

  // WU-2241: Wrap cleanup operations in cleanup lock to prevent concurrent collision
  await withCleanupLock(
    wuId,
    async () => {
      await runCleanupInternal(docMain, args, worktreePath);
    },
    { worktreePath },
  );
}

/**
 * Internal cleanup implementation (runs under cleanup lock)
 */
async function runCleanupInternal(docMain, args, worktreePath) {
  // Step 6: Remove worktree (runs even if commit/push failed)
  // Skip removal in PR mode (worktree needed for cleanup after PR merge)
  const claimedMode = docMain.claimed_mode || CLAIMED_MODES.WORKTREE;
  const requiresReview = docMain.requires_review === true;
  // WU-1492: Include branch-pr in PR-mode check (preserves worktree for post-merge cleanup)
  const prModeEnabled =
    claimedMode === CLAIMED_MODES.WORKTREE_PR ||
    claimedMode === CLAIMED_MODES.BRANCH_PR ||
    args.createPR ||
    requiresReview;

  // WU-2241: Track branch for cleanup after worktree removal
  const laneBranch = await defaultBranchFrom(docMain);

  if (!args.noRemove && !prModeEnabled) {
    if (worktreePath && existsSync(worktreePath)) {
      try {
        await getGitForCwd().worktreeRemove(worktreePath, { force: true });
        console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Removed worktree ${worktreePath}`);

        // WU-2241: Delete branch AFTER worktree removal (correct ordering)
        // This ensures we don't leave orphan branches when worktree is removed
        if (laneBranch && (await branchExists(laneBranch))) {
          await deleteBranchWithCleanup(laneBranch);
        }

        // WU-1743: Re-run pnpm install to fix broken symlinks
        // When pnpm install runs in a worktree, it may create symlinks with absolute paths
        // to the worktree. After worktree removal, these symlinks break.
        // Re-running pnpm install regenerates them with correct paths.
        // WU-2278: Use timeout and CI=true to prevent hangs
        console.log(`${LOG_PREFIX.DONE} Reinstalling dependencies to fix symlinks...`);
        try {
          const installConfig = getCleanupInstallConfig();
          await execAsync(installConfig.command, {
            timeout: installConfig.timeout,
            env: installConfig.env,
          });
          console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Dependencies reinstalled`);
        } catch (installErr) {
          // Non-fatal: warn but don't fail wu:done
          // WU-2278: Include timeout info in error message
          const isTimeout = installErr.killed || installErr.signal === 'SIGTERM';
          const errorMsg = isTimeout
            ? `pnpm install timed out after ${CLEANUP_INSTALL_TIMEOUT_MS / 1000}s`
            : `pnpm install failed: ${installErr.message}`;
          console.warn(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} ${errorMsg}`);
        }
      } catch (e) {
        console.warn(`${LOG_PREFIX.DONE} Could not remove worktree ${worktreePath}: ${e.message}`);
      }
    } else {
      console.log(`${LOG_PREFIX.DONE} Worktree not found; skipping removal`);

      // WU-2241: Still cleanup branch if worktree doesn't exist (orphan branch scenario)
      if (!prModeEnabled && laneBranch && (await branchExists(laneBranch))) {
        await deleteBranchWithCleanup(laneBranch);
      }
    }
  } else if (prModeEnabled) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Worktree preserved (PR mode - run wu:cleanup after PR merge)`,
    );
  }
}

/**
 * WU-2241: Delete both local and remote branch with proper error handling
 */
async function deleteBranchWithCleanup(laneBranch) {
  const gitAdapter = getGitForCwd();

  // WU-1440: Check if branch is merged before deletion
  // Use -D (force) when confirmed merged to handle rebased branches
  const isMerged = await isBranchAlreadyMerged(laneBranch);

  const isMergedIntoRemoteMain = async () => {
    try {
      await gitAdapter.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
      await gitAdapter.raw([
        'merge-base',
        '--is-ancestor',
        laneBranch,
        `${REMOTES.ORIGIN}/${BRANCHES.MAIN}`,
      ]);
      return true;
    } catch {
      return false;
    }
  };

  try {
    await gitAdapter.deleteBranch(laneBranch, { force: isMerged });
    const modeIndicator = isMerged ? ' (force: merged)' : '';
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Deleted local branch ${laneBranch}${modeIndicator}`,
    );

    // Also delete remote if it exists
    try {
      await gitAdapter.raw(['push', REMOTES.ORIGIN, '--delete', laneBranch]);
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Deleted remote branch ${laneBranch}`);
    } catch (e) {
      // WU-2241: Non-fatal - remote branch may already be deleted or never existed
      console.warn(`${LOG_PREFIX.DONE} Could not delete remote branch: ${e.message}`);
    }
  } catch (e) {
    const errorMessage = e instanceof Error ? e.message : String(e);

    // WU-1657: If local merge state lags and branch reports "not fully merged",
    // check against origin/main and force-delete when remote already contains the branch.
    if (/not fully merged/i.test(errorMessage)) {
      const mergedOnRemoteMain = await isMergedIntoRemoteMain();
      if (mergedOnRemoteMain) {
        try {
          await gitAdapter.deleteBranch(laneBranch, { force: true });
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Deleted local branch ${laneBranch} (force: merged on origin/main)`,
          );
          return;
        } catch (forceErr) {
          const forceMessage = forceErr instanceof Error ? forceErr.message : String(forceErr);
          console.warn(
            `${LOG_PREFIX.DONE} Could not force-delete branch ${laneBranch} after remote-merge verification: ${forceMessage}`,
          );
        }
      }
    }

    console.warn(`${LOG_PREFIX.DONE} Could not delete branch ${laneBranch}: ${e.message}`);
  }
}
