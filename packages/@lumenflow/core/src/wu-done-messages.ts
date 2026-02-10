/**
 * @file wu-done-messages.ts
 * @description Constants and message templates for wu-done operations
 * WU-1159: Eliminate string literals (DRY/SOLID compliance)
 * WU-1281: Use centralized LOG_PREFIX and EMOJI from wu-constants.ts
 *
 * All log messages, error messages, and text templates extracted to constants.
 * Prevents duplication and makes text maintainable.
 */

import { LOG_PREFIX, EMOJI, REMOTES, BRANCHES } from './wu-constants.js';

// Re-export LOG_PREFIX for backwards compatibility
export { LOG_PREFIX };

/**
 * Recovery mode messages (WU-1159)
 */
export const RECOVERY = {
  DETECTED: `${LOG_PREFIX.DONE} ${EMOJI.WARNING} RECOVERY MODE: Status is already "done" but worktree exists.`,
  RESUMING: `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Resuming cleanup to complete the WU...`,
  EXPLANATION: `${LOG_PREFIX.DONE} This typically happens when a previous wu:done crashed mid-completion.`,
  CREATING_STAMP: `${LOG_PREFIX.DONE} Creating missing stamp file...`,
  STAMP_CREATED: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Stamp file created`,
  UPDATING_YAML: `${LOG_PREFIX.DONE} Updating WU YAML to ensure completion markers...`,
  YAML_UPDATED: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU YAML updated with completion markers`,
  UPDATING_DOCS: `${LOG_PREFIX.DONE} Ensuring status.md and backlog.md are updated...`,
  DOCS_UPDATED: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Documentation files verified`,
  COMMITTING: `${LOG_PREFIX.DONE} Committing recovery changes to prevent data loss...`,
  COMMIT_SUCCESS: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Recovery changes committed to main`,
  COMMIT_FAILED: (error) =>
    `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not commit recovery changes: ${error} (metadata still on disk)`,
  MARKERS_VERIFIED: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Recovery mode: All completion markers verified`,
  PROCEEDING_CLEANUP: `${LOG_PREFIX.DONE} Proceeding to cleanup (worktree removal and branch deletion)...`,
  SUCCESS: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Recovery mode successful - zombie state cleaned up`,
};

/**
 * Worktree operations
 */
export const WORKTREE = {
  REMOVED: (path) => `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Removed worktree ${path}`,
  NOT_FOUND: `${LOG_PREFIX.DONE} Worktree not found; skipping removal`,
  REMOVE_FAILED: (path, error) => `${LOG_PREFIX.DONE} Could not remove worktree ${path}: ${error}`,
  PRESERVED_PR_MODE: `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Worktree preserved (PR mode - run wu:cleanup after PR merge)`,
};

/**
 * Branch operations
 */
export const BRANCH = {
  DELETED_LOCAL: (branch) => `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Deleted local branch ${branch}`,
  DELETED_REMOTE: (branch) => `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Deleted remote branch ${branch}`,
  DELETE_FAILED: (branch, error) =>
    `${LOG_PREFIX.DONE} Could not delete branch ${branch}: ${error}`,
  DELETE_REMOTE_FAILED: (error) => `${LOG_PREFIX.DONE} Could not delete remote branch: ${error}`,
  PRESERVED_PR_MODE: `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Branch preserved (PR mode - delete manually after merge)`,
};

/**
 * Completion messages
 */
export const COMPLETION = {
  SUCCESS_HEADER: (id, title) =>
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Marked done, pushed, and cleaned up.\n- WU: ${id} — ${title}`,
  TRANSACTION_COMMIT: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Transaction COMMIT - all steps succeeded (WU-755)`,
};

/**
 * State transition errors
 */
export const STATE_TRANSITION = {
  VALIDATION_FAILED: (error) => `State transition validation failed: ${error}`,
};

/**
 * Auto-rebase messages (WU-1303)
 */
export const REBASE = {
  STARTING: (branch, mainBranch) =>
    `${LOG_PREFIX.DONE} ${EMOJI.WRENCH} Auto-rebasing ${branch} onto ${mainBranch}...`,
  SUCCESS: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Auto-rebase completed successfully`,
  FAILED: (error) => `${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Auto-rebase failed: ${error}`,
  ABORTED: `${LOG_PREFIX.DONE} ${EMOJI.INFO} Rebase aborted - worktree left clean`,
  MANUAL_FIX: (worktreePath, remote, mainBranch, branch) =>
    `Auto-rebase failed due to conflicts.\n\n` +
    `Manual resolution required:\n` +
    `  1. cd ${worktreePath}\n` +
    `  2. git fetch ${remote} ${mainBranch}\n` +
    `  3. git rebase ${remote}/${mainBranch}\n` +
    `  4. Resolve conflicts and run: git rebase --continue\n` +
    `  5. git push --force-with-lease ${remote} ${branch}\n` +
    `  6. Return to main checkout and retry: pnpm wu:done --id <WU-ID>`,
};

/**
 * Pre-flight check messages (WU-755, WU-1303, WU-1370)
 */
export const PREFLIGHT = {
  RUNNING: `\n${LOG_PREFIX.DONE} Running pre-flight checks (WU-755)...`,
  BRANCH_BEHIND: (commitsBehind, threshold) =>
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} Branch is ${commitsBehind} commits behind main (threshold: ${threshold})`,
  // WU-1370: Graduated drift warning messages
  BRANCH_DRIFT_INFO: (commitsBehind) =>
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} Branch is ${commitsBehind} commits behind main. Consider rebasing to reduce merge conflicts.`,
  BRANCH_DRIFT_WARNING: (commitsBehind) =>
    `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Branch is ${commitsBehind} commits behind main. Rebase recommended before completing.`,
  DIVERGENCE_DETECTED: (commitCount) =>
    `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Branch divergence detected: main is ${commitCount} commit(s) ahead`,
  NO_DIVERGENCE: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pre-flight: No branch divergence (main has not advanced)`,
  NO_CONFLICTS: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pre-flight: No merge conflicts detected`,
  ALREADY_MERGED: `\n${LOG_PREFIX.DONE} ${EMOJI.INFO} Branch already merged to main - proceeding with metadata-only completion`,
  ALREADY_MERGED_EXPLANATION: `         This is normal when code was merged via emergency fix or manual merge.`,
  BRANCH_INFO: (branch, branchTip, mergeBase, mainHead) =>
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} Branch ${branch} is already merged to main\n` +
    `         Branch tip: ${branchTip}\n` +
    `         Merge-base: ${mergeBase}\n` +
    `         Main HEAD:  ${mainHead}`,
  BRANCH_DRIFT_ERROR: (mainAhead, threshold, remote, mainBranch) =>
    `⚠️  BRANCH DRIFT DETECTED (WU-755 pre-flight check)\n\n` +
    `Your branch is ${mainAhead} commits behind main (threshold: ${threshold} commits).\n` +
    `This increases risk of merge conflicts at completion.\n\n` +
    `REQUIRED: Rebase your branch before completing:\n` +
    `  1. cd into your worktree\n` +
    `  2. Run: git fetch ${remote} ${mainBranch} && git rebase ${remote}/${mainBranch}\n` +
    `  3. Resolve any conflicts that arise\n` +
    `  4. Return to main checkout and retry: pnpm wu:done --id <WU-ID>`,
  DIVERGENCE_ERROR: (commitCount, remote, mainBranch, branch) =>
    `⚠️  BRANCH DIVERGENCE DETECTED (emergency fix protection)\n\n` +
    `Main has advanced ${commitCount} commit(s) since your branch was created.\n` +
    `Fast-forward merge is impossible.\n\n` +
    `REQUIRED: Rebase your branch onto current main:\n` +
    `  1. cd into your worktree\n` +
    `  2. Fetch latest main: git fetch ${remote} ${mainBranch}\n` +
    `  3. Rebase onto main: git rebase ${remote}/${mainBranch}\n` +
    `  4. Force-push lane branch: git push --force-with-lease ${remote} ${branch}\n` +
    `  5. Return to main checkout and retry`,
  CONFLICT_ERROR: (remote = REMOTES.ORIGIN, mainBranch = BRANCHES.MAIN) =>
    `⚠️  MERGE CONFLICTS DETECTED (WU-755 pre-flight check)\n\n` +
    `Cannot complete WU - merge conflicts found between main and your branch.\n\n` +
    `REQUIRED: Resolve conflicts before completing:\n` +
    `  1. cd into your worktree\n` +
    `  2. Run: git fetch ${remote} ${mainBranch} && git rebase ${remote}/${mainBranch}\n` +
    `  3. Resolve conflicts that arise during rebase\n` +
    `  4. Run: git rebase --continue after resolving each conflict\n` +
    `  5. Return to main checkout and retry`,
  // WU-1384: Merge commit detection for linear history enforcement
  MERGE_COMMITS_DETECTED: (count) =>
    `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Detected ${count} merge commit(s) in lane branch (GitHub requires linear history)`,
  MERGE_COMMITS_REBASING: `${LOG_PREFIX.DONE} ${EMOJI.WRENCH} Rebasing to eliminate merge commits and maintain linear history...`,
  NO_MERGE_COMMITS: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pre-flight: No merge commits in branch (linear history)`,
  // WU-1456: Empty merge detection - prevents completing WUs with no actual work
  EMPTY_MERGE_WARNING: (commitCount) =>
    `\n${LOG_PREFIX.DONE} ⚠️  WARNING: Only ${commitCount} commit(s) on lane branch beyond claim.\n` +
    `         This may indicate no code changes were committed before running wu:done.\n` +
    `         If this is intentional (docs-only or metadata update), you may proceed.\n` +
    `         Otherwise, check that your changes were committed in the worktree.\n`,
  EMPTY_MERGE_CHECK: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pre-flight: Branch has work commits beyond claim`,
  // WU-1460: code_paths blocker - prevents completing WUs with code_paths defined but files not modified
  CODE_PATHS_NOT_MODIFIED: (missingFiles) =>
    `Cannot complete WU - code_paths files were NOT modified in any commits.\n\n` +
    `This WU defines code_paths that should have been implemented:\n` +
    missingFiles.map((f) => `  - ${f}`).join('\n') +
    `\n\nThis error prevents completing a WU without actually committing the code.\n` +
    `The worktree would be deleted and your work would be lost.\n\n` +
    `REQUIRED: Commit your code changes before running wu:done:\n` +
    `  1. cd into your worktree\n` +
    `  2. git add <your files>\n` +
    `  3. git commit -m "feat: <description>"\n` +
    `  4. Return to main and retry: pnpm wu:done --id <WU-ID>`,
  CODE_PATHS_VERIFIED: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pre-flight: code_paths files modified in commits`,
};

/**
 * Merge operation messages (WU-1303)
 */
export const MERGE = {
  STARTING: (_branch) => `\n${LOG_PREFIX.DONE} Merging lane branch to main (metadata + code)...`,
  BRANCH_MERGE: (branch) =>
    `\n${LOG_PREFIX.DONE} Merging branch ${branch} to main (fast-forward only)...`,
  SUCCESS: (branch) =>
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Merged ${branch} successfully (fast-forward)`,
  ATOMIC_SUCCESS: `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Metadata and code merged to main atomically`,
  FF_FAILED_RETRY: `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Fast-forward failed, updating main and retrying...`,
  UPDATED_MAIN: (remote) =>
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Updated main from ${remote}, retrying merge...`,
  PUSHED: (remote, mainBranch) =>
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pushed to ${remote}/${mainBranch}`,
  FF_MERGE_ERROR: (
    branch,
    mergeError,
    pullError,
    remote = REMOTES.ORIGIN,
    mainBranch = BRANCHES.MAIN,
  ) =>
    `Fast-forward merge failed and retry with git pull also failed.\n\n` +
    `Original merge error: ${mergeError}\n` +
    `Pull error: ${pullError}\n\n` +
    `Manual fix required:\n` +
    `  1. git pull ${remote} ${mainBranch}\n` +
    `  2. Resolve any conflicts\n` +
    `  3. Switch to your worktree and rebase onto ${mainBranch}\n` +
    `  4. Return to main checkout and retry`,
  FF_DIVERGED_ERROR: (branch, originalError, mainBranch = BRANCHES.MAIN) =>
    `Fast-forward merge failed for ${branch}.\n\n` +
    `This means your branch has diverged from ${mainBranch}.\n` +
    `To fix:\n` +
    `  1. Switch to your worktree: cd <worktree-path>\n` +
    `  2. Rebase onto ${mainBranch}: git rebase ${mainBranch}\n` +
    `  3. Return to main checkout and retry`,
  FF_FAILED_NON_DIVERGED_ERROR: (branch, originalError, mainBranch = BRANCHES.MAIN) =>
    `Fast-forward merge failed for ${branch}, but ${mainBranch} is an ancestor.\n\n` +
    `This indicates the merge did not fail due to divergence.\n` +
    `Underlying git error: ${originalError}\n\n` +
    `Next steps:\n` +
    `  1. Re-run: pnpm wu:done --id <WU-ID>\n` +
    `  2. If it repeats, check for concurrent git activity and retry after a short wait`,
};

/**
 * Pre-push gate messages (WU-1303)
 */
export const PREPUSH = {
  WORKTREE_SKIP: '[pre-push] Worktree detected - skipping gates (validated at merge via wu:done)',
};
