/**
 * @file wu-claim-cloud.ts
 * @description Cloud mode helpers for wu:claim command
 *
 * WU-1590 AC2: Provides metadata builder and branch-exists check helpers
 * for --cloud claim path that persists claimed_branch and bypasses
 * remote/local branch-exists checks when claiming on the current branch.
 *
 * Cloud agents execute from existing feature branches and cannot create
 * worktrees. This module extracts the decision logic for persisting
 * claimed_branch and bypassing branch existence guards.
 */

import { CLAIMED_MODES } from '@lumenflow/core/wu-constants';

/**
 * Input for building cloud claim metadata
 */
export interface CloudClaimMetadataInput {
  /** Current git branch name */
  currentBranch: string;
  /** WU ID being claimed */
  wuId: string;
  /** Lane for the claim */
  lane: string;
}

/**
 * Cloud claim metadata to persist in WU YAML
 */
export interface CloudClaimMetadata {
  /** The branch where the WU is claimed (persisted for later resolution) */
  claimed_branch: string;
  /** Claimed mode is always branch-pr for cloud agents */
  claimed_mode: string;
}

/**
 * Build claim metadata for cloud mode.
 *
 * Persists the current branch as claimed_branch so that wu:prep, wu:done,
 * and wu:cleanup can resolve it via defaultBranchFrom() without relying
 * on lane-derived branch naming.
 *
 * @param input - Cloud claim metadata input
 * @returns Metadata fields to merge into WU YAML
 */
export function buildCloudClaimMetadata(input: CloudClaimMetadataInput): CloudClaimMetadata {
  return {
    claimed_branch: input.currentBranch,
    claimed_mode: CLAIMED_MODES.BRANCH_PR,
  };
}

/**
 * Input for branch-exists check decision
 */
export interface BranchExistsCheckInput {
  /** Whether cloud mode is active */
  isCloud: boolean;
  /** Current git branch name */
  currentBranch: string;
  /** Lane-derived branch name (e.g., lane/framework-cli/wu-1590) */
  laneBranch: string;
}

/**
 * Determine whether to skip remote/local branch-exists checks.
 *
 * Cloud agents claim on an existing branch (e.g., claude/feature-xyz).
 * The standard branch-exists check would reject the claim because the branch
 * already exists. In cloud mode, the branch existence IS expected.
 *
 * @param input - Branch-exists check input
 * @returns true if branch-exists checks should be skipped
 */
export function shouldSkipBranchExistsCheck(input: BranchExistsCheckInput): boolean {
  return input.isCloud;
}

export interface BranchClaimExecutionInput {
  claimedMode: string;
  isCloud: boolean;
  currentBranch: string;
  requestedBranch: string;
}

export interface BranchClaimExecution {
  executionBranch: string;
  shouldCreateBranch: boolean;
}

/**
 * Resolve execution branch behavior for branch-only style claims.
 *
 * In cloud branch-pr mode, agents must stay on the current branch and avoid
 * creating/switching to lane-derived branches.
 */
export function resolveBranchClaimExecution(input: BranchClaimExecutionInput): BranchClaimExecution {
  if (input.claimedMode === CLAIMED_MODES.BRANCH_PR && input.isCloud) {
    return {
      executionBranch: input.currentBranch,
      shouldCreateBranch: false,
    };
  }

  return {
    executionBranch: input.requestedBranch,
    shouldCreateBranch: true,
  };
}
