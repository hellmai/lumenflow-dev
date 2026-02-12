/**
 * @file wu-done-cloud.ts
 * @description Cloud mode helpers for wu:done command
 *
 * WU-1590 AC3: Provides preflight helpers for branch-pr wu:done path that
 * skips ensureOnMain and validates branch-pr code_paths against HEAD.
 *
 * In branch-pr mode, wu:done runs on the lane branch (not main). The
 * standard ensureOnMain check would reject execution. Instead, code_paths
 * are validated against the files present on HEAD.
 */

import { CLAIMED_MODES } from '@lumenflow/core/wu-constants';

/**
 * Determine whether to skip ensureOnMain for wu:done.
 *
 * Branch-pr mode WUs execute wu:done from the lane branch, not main.
 * ensureOnMain would incorrectly reject them.
 *
 * @param doc - Partial WU YAML with claimed_mode
 * @returns true if ensureOnMain should be skipped
 */
export function shouldSkipEnsureOnMainForDone(doc: { claimed_mode?: string }): boolean {
  return doc.claimed_mode === CLAIMED_MODES.BRANCH_PR;
}

/**
 * Input for code_paths validation against HEAD
 */
export interface CodePathsHeadValidationInput {
  /** Code paths from WU YAML */
  codePaths: string[];
  /** Files that exist on HEAD (provided by caller via git ls-files or fs check) */
  existingFiles: string[];
}

/**
 * Result of code_paths validation against HEAD
 */
export interface CodePathsHeadValidationResult {
  /** Whether all code_paths are covered */
  valid: boolean;
  /** Paths that do not exist on HEAD */
  missingPaths: string[];
}

/**
 * Validate that branch-pr code_paths exist on the current HEAD.
 *
 * In branch-pr mode, we cannot validate against main (because the agent is
 * on a feature branch). Instead, we validate that all declared code_paths
 * are present in the working tree.
 *
 * @param input - Code paths and existing files on HEAD
 * @returns Validation result with missing paths
 */
export function validateBranchPrCodePathsAgainstHead(
  input: CodePathsHeadValidationInput,
): CodePathsHeadValidationResult {
  if (input.codePaths.length === 0) {
    return { valid: true, missingPaths: [] };
  }

  const existingSet = new Set(input.existingFiles);
  const missingPaths = input.codePaths.filter((cp) => !existingSet.has(cp));

  return {
    valid: missingPaths.length === 0,
    missingPaths,
  };
}
