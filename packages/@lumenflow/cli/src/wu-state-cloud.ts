/**
 * @file wu-state-cloud.ts
 * @description Cloud branch-pr helpers for WU state commands.
 *
 * WU-1591: Centralizes branch-pr path selection for wu:edit, wu:block,
 * wu:unblock, wu:release, and wu:delete so commands can run on the active
 * branch without micro-worktree pushes to main.
 */

export const BRANCH_PR_MODE = 'branch-pr';
export const BRANCH_ONLY_MODE = 'branch-only';

export const WORKTREE_EDIT_MODE = 'worktree';
export const BRANCH_PR_EDIT_MODE = 'branch-pr';
export const BLOCKED_EDIT_MODE = 'blocked';

export interface ClaimedModeDoc {
  claimed_mode?: string;
}

/**
 * Returns true when command execution should run on the active claimed branch.
 */
export function shouldUseBranchPrStatePath(doc: ClaimedModeDoc): boolean {
  return doc.claimed_mode === BRANCH_PR_MODE;
}

/**
 * Resolve the in-progress edit mode from claimed_mode.
 */
export function resolveInProgressEditMode(claimedMode?: string): string {
  if (claimedMode === BRANCH_PR_MODE) {
    return BRANCH_PR_EDIT_MODE;
  }

  if (claimedMode === BRANCH_ONLY_MODE) {
    return BLOCKED_EDIT_MODE;
  }

  return WORKTREE_EDIT_MODE;
}

/**
 * Delete should use branch-pr path if any target WU is branch-pr claimed.
 */
export function shouldUseBranchPrDeletePath(docs: ClaimedModeDoc[]): boolean {
  return docs.some((doc) => shouldUseBranchPrStatePath(doc));
}
