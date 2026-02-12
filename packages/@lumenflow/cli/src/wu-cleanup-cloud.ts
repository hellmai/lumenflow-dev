/**
 * @file wu-cleanup-cloud.ts
 * @description Cloud mode helpers for wu:cleanup command
 *
 * WU-1590 AC5: Provides helpers for wu:cleanup to resolve claimed_branch,
 * verify merged PR against that branch, skip worktree-only checks in
 * branch-pr mode, and avoid deleting non-lane cloud-managed branches.
 *
 * Cloud agents use branches like claude/feature-xyz or codex/some-task
 * that should NOT be deleted by wu:cleanup (they're managed by the cloud
 * platform, not LumenFlow).
 */

import { CLAIMED_MODES, toKebab } from '@lumenflow/core/wu-constants';

/** Prefixes for cloud-managed branches that should not be deleted */
const CLOUD_BRANCH_PREFIXES = ['claude/', 'codex/', 'ci/', 'cloud/'];

/** Prefix for LumenFlow lane-derived branches */
const LANE_BRANCH_PREFIX = 'lane/';

/**
 * Input for resolving the cleanup branch
 */
export interface CleanupBranchInput {
  /** claimed_branch from WU YAML (set at cloud claim time) */
  claimed_branch?: string;
  /** WU lane */
  lane: string;
  /** WU ID (lowercase) */
  id: string;
}

/**
 * Resolve which branch to use for cleanup operations.
 *
 * Priority:
 * 1. claimed_branch (canonical, set at cloud claim time)
 * 2. Lane-derived naming (lane/<kebab-lane>/<wu-id>)
 *
 * @param input - Branch resolution input
 * @returns Resolved branch name
 */
export function resolveCleanupBranch(input: CleanupBranchInput): string {
  // Priority 1: Use claimed_branch if present
  if (input.claimed_branch && input.claimed_branch.trim()) {
    return input.claimed_branch;
  }

  // Priority 2: Fall back to lane-derived naming
  const laneK = toKebab(input.lane);
  const idK = input.id.toLowerCase();
  return `${LANE_BRANCH_PREFIX}${laneK}/${idK}`;
}

/**
 * Determine whether to skip worktree-specific checks during cleanup.
 *
 * Branch-pr mode WUs have no worktree to check or remove. Worktree-only
 * checks (uncommitted changes, ownership validation) should be skipped.
 *
 * @param doc - Partial WU YAML with claimed_mode
 * @returns true if worktree checks should be skipped
 */
export function shouldSkipWorktreeChecks(doc: { claimed_mode?: string }): boolean {
  return doc.claimed_mode === CLAIMED_MODES.BRANCH_PR;
}

/**
 * Determine whether a branch is cloud-managed (should not be deleted by LumenFlow).
 *
 * Cloud platforms (Codex, Claude web) create branches like claude/feature-xyz.
 * These are managed by the cloud platform and should NOT be deleted during cleanup.
 * Only LumenFlow lane-derived branches (lane/...) are safe to delete.
 *
 * @param branchName - Branch name to check
 * @returns true if the branch is cloud-managed and should NOT be deleted
 */
export function isCloudManagedBranch(branchName: string): boolean {
  // Lane-derived branches are always safe to delete
  if (branchName.startsWith(LANE_BRANCH_PREFIX)) {
    return false;
  }

  // Check against known cloud-managed prefixes
  return CLOUD_BRANCH_PREFIXES.some((prefix) => branchName.startsWith(prefix));
}
