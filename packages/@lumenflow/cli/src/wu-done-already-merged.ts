// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2211: wu:done --already-merged finalize-only mode
 *
 * When code is already on main but WU metadata is incomplete
 * (bootstrap failure, manual merge, aborted wu:done), the normal
 * wu:done flow requires a worktree that may not exist.
 *
 * This module provides:
 * 1. verifyCodePathsOnMainHead - Safety check that code_paths exist on HEAD
 * 2. executeAlreadyMergedFinalize - Finalize metadata via micro-worktree commit
 *
 * The --already-merged flag causes wu:done to skip the merge phase entirely
 * and write stamp/events/backlog/status via a micro-worktree atomic commit.
 */

import { getGitForCwd } from '@lumenflow/core/git-adapter';
import {
  LOG_PREFIX,
  EMOJI,
  STRING_LITERALS,
  GIT_REFS,
} from '@lumenflow/core/wu-constants';
import { executeAlreadyMergedCompletion } from '@lumenflow/core/wu-done-merged-worktree';
import { getErrorMessage } from '@lumenflow/core/error-handler';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface CodePathVerificationResult {
  /** Whether all code_paths exist on HEAD of main */
  valid: boolean;
  /** List of code_paths that are missing from HEAD */
  missing: string[];
  /** Human-readable error message (undefined if valid) */
  error?: string;
}

export interface AlreadyMergedFinalizeParams {
  /** WU identifier (e.g. 'WU-2211') */
  id: string;
  /** WU title */
  title: string;
  /** WU lane */
  lane: string;
  /** WU doc from YAML (full parsed document) */
  doc: Record<string, unknown>;
}

export interface AlreadyMergedFinalizeResult {
  /** Whether finalization completed successfully */
  success: boolean;
  /** Whether stamp was created or already existed */
  stamped: boolean;
  /** Whether WU YAML was updated */
  yamlUpdated: boolean;
  /** Whether backlog/status were updated */
  backlogUpdated: boolean;
  /** Error messages if any */
  errors: string[];
}

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const GIT_LS_TREE = 'ls-tree';
const ALREADY_MERGED_LOG_TAG = 'WU-2211';

// ──────────────────────────────────────────────
// Safety Check: Verify code_paths exist on HEAD
// ──────────────────────────────────────────────

/**
 * Verify that all code_paths from a WU YAML exist on HEAD of main.
 *
 * This is the safety check for --already-merged mode. If code_paths
 * are missing, the WU's code was NOT actually merged and --already-merged
 * should not be used.
 *
 * Uses `git ls-tree HEAD -- <path>` for each code_path. Returns a
 * structured result with missing paths and error message.
 *
 * @param codePaths - Array of relative file paths from WU YAML
 * @returns Verification result with valid flag, missing paths, and error
 */
export async function verifyCodePathsOnMainHead(
  codePaths: string[],
): Promise<CodePathVerificationResult> {
  if (codePaths.length === 0) {
    return { valid: true, missing: [] };
  }

  const gitAdapter = getGitForCwd();
  const missing: string[] = [];

  for (const filePath of codePaths) {
    try {
      const result = await gitAdapter.raw([
        GIT_LS_TREE,
        GIT_REFS.HEAD,
        '--',
        filePath,
      ]);
      if (!result || result.trim() === '') {
        missing.push(filePath);
      }
    } catch {
      missing.push(filePath);
    }
  }

  if (missing.length === 0) {
    return { valid: true, missing: [] };
  }

  const missingList = missing.map((p) => `  - ${p}`).join(STRING_LITERALS.NEWLINE);
  const error =
    `${ALREADY_MERGED_LOG_TAG}: code_paths not found on HEAD of main:${STRING_LITERALS.NEWLINE}` +
    `${missingList}${STRING_LITERALS.NEWLINE}${STRING_LITERALS.NEWLINE}` +
    `These files are listed in the WU YAML code_paths but do not exist on HEAD.${STRING_LITERALS.NEWLINE}` +
    `This means the code was NOT actually merged to main.${STRING_LITERALS.NEWLINE}${STRING_LITERALS.NEWLINE}` +
    `Do NOT use --already-merged unless the code is truly on main.${STRING_LITERALS.NEWLINE}` +
    `Options:${STRING_LITERALS.NEWLINE}` +
    `  1. Merge the code first, then rerun with --already-merged${STRING_LITERALS.NEWLINE}` +
    `  2. Use the normal wu:done workflow (without --already-merged)${STRING_LITERALS.NEWLINE}` +
    `  3. Update code_paths in WU YAML if files were renamed/removed`;

  return { valid: false, missing, error };
}

// ──────────────────────────────────────────────
// Finalize: Write metadata and commit
// ──────────────────────────────────────────────

/**
 * Execute the finalize-only path for --already-merged mode.
 *
 * Creates stamp, updates WU YAML to done, updates backlog and status.
 * Reuses executeAlreadyMergedCompletion from wu-done-merged-worktree.ts
 * which handles all metadata writes with individual error capture.
 *
 * The caller (wu:done main()) is responsible for committing and pushing
 * the resulting changes via the micro-worktree pattern.
 *
 * @param params - Finalization parameters
 * @returns Result with per-operation status and any errors
 */
export async function executeAlreadyMergedFinalize(
  params: AlreadyMergedFinalizeParams,
): Promise<AlreadyMergedFinalizeResult> {
  const { id, title, lane } = params;

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} ${ALREADY_MERGED_LOG_TAG}: Finalize-only mode -- skipping merge phase`,
  );

  try {
    const result = await executeAlreadyMergedCompletion({ id, title, lane });

    if (result.success) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} ${ALREADY_MERGED_LOG_TAG}: Finalization complete`,
      );
    } else {
      console.warn(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} ${ALREADY_MERGED_LOG_TAG}: Finalization completed with errors`,
      );
    }

    return {
      success: result.success,
      stamped: result.stamped,
      yamlUpdated: result.yamlUpdated,
      backlogUpdated: result.backlogUpdated,
      errors: result.errors,
    };
  } catch (err) {
    const errorMessage = getErrorMessage(err);
    console.error(
      `${LOG_PREFIX.DONE} ${EMOJI.FAILURE} ${ALREADY_MERGED_LOG_TAG}: Finalization failed: ${errorMessage}`,
    );
    return {
      success: false,
      stamped: false,
      yamlUpdated: false,
      backlogUpdated: false,
      errors: [errorMessage],
    };
  }
}
