/**
 * @file wu-claim-mode.ts
 * @description Mode resolution for wu:claim command
 *
 * WU-1491: Pure function that resolves CLI flag combinations into a claimed mode.
 *
 * Mode matrix:
 * - default (no flags)       -> worktree
 * - --branch-only            -> branch-only
 * - --pr-mode                -> worktree-pr
 * - --cloud                  -> branch-pr
 * - --branch-only --pr-mode  -> branch-pr
 * - --cloud --branch-only    -> error (conflicting)
 * - --cloud --pr-mode        -> branch-pr (pr-mode redundant with cloud)
 */

import { CLAIMED_MODES } from '@lumenflow/core/wu-constants';

/**
 * Input flags for mode resolution
 */
export interface ClaimModeFlags {
  branchOnly?: boolean;
  prMode?: boolean;
  cloud?: boolean;
}

/**
 * Result of mode resolution
 */
export interface ClaimModeResult {
  /** Resolved claimed mode (undefined if error) */
  mode?: string;
  /** Error message (undefined if successful) */
  error?: string;
  /** Whether to skip the branch-only singleton guard (true for worktree & branch-pr) */
  skipBranchOnlySingletonGuard: boolean;
  /** Whether lane lock is required (always true) */
  requireLaneLock: boolean;
  /** Whether lane WIP check is required (always true) */
  requireLaneWipCheck: boolean;
}

/**
 * Resolve CLI flag combination into a claimed mode with guard requirements.
 *
 * @param flags - CLI flags from parsed arguments
 * @returns Resolution result with mode and guard requirements
 */
export function resolveClaimMode(flags: ClaimModeFlags): ClaimModeResult {
  const { branchOnly, prMode, cloud } = flags;

  // Conflict: --cloud and --branch-only are mutually exclusive
  // --cloud implies branch-pr directly; --branch-only without --pr-mode means branch-only
  if (cloud && branchOnly) {
    return {
      error:
        'Conflicting flags: --cloud and --branch-only cannot be used together. ' +
        'Use --cloud for branch-pr mode, or --branch-only for branch-only mode.',
      skipBranchOnlySingletonGuard: false,
      requireLaneLock: true,
      requireLaneWipCheck: true,
    };
  }

  // --cloud -> branch-pr (regardless of --pr-mode, which is redundant)
  if (cloud) {
    return {
      mode: CLAIMED_MODES.BRANCH_PR,
      skipBranchOnlySingletonGuard: true,
      requireLaneLock: true,
      requireLaneWipCheck: true,
    };
  }

  // --branch-only --pr-mode -> branch-pr
  if (branchOnly && prMode) {
    return {
      mode: CLAIMED_MODES.BRANCH_PR,
      skipBranchOnlySingletonGuard: true,
      requireLaneLock: true,
      requireLaneWipCheck: true,
    };
  }

  // --branch-only -> branch-only (requires singleton guard)
  if (branchOnly) {
    return {
      mode: CLAIMED_MODES.BRANCH_ONLY,
      skipBranchOnlySingletonGuard: false,
      requireLaneLock: true,
      requireLaneWipCheck: true,
    };
  }

  // --pr-mode -> worktree-pr
  if (prMode) {
    return {
      mode: CLAIMED_MODES.WORKTREE_PR,
      skipBranchOnlySingletonGuard: true,
      requireLaneLock: true,
      requireLaneWipCheck: true,
    };
  }

  // Default -> worktree
  return {
    mode: CLAIMED_MODES.WORKTREE,
    skipBranchOnlySingletonGuard: true,
    requireLaneLock: true,
    requireLaneWipCheck: true,
  };
}
