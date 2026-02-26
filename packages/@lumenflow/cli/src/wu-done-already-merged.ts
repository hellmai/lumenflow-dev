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
import { withMicroWorktree } from '@lumenflow/core/micro-worktree';
import { collectMetadataToTransaction } from '@lumenflow/core/wu-done-metadata';
import { WUTransaction } from '@lumenflow/core/wu-transaction';
import { WU_PATHS } from '@lumenflow/core/wu-paths';
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
const OPERATION_NAME = 'wu-done-already-merged';

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
// Finalize: Write metadata via micro-worktree
// ──────────────────────────────────────────────

/**
 * Execute the finalize-only path for --already-merged mode.
 *
 * Creates stamp, updates WU YAML to done, updates backlog and status,
 * emits completion event -- all via a micro-worktree atomic commit.
 *
 * Uses collectMetadataToTransaction + withMicroWorktree for atomicity.
 * This ensures all metadata changes are committed and pushed to origin/main
 * in a single atomic operation.
 *
 * @param params - Finalization parameters
 * @returns Result with per-operation status and any errors
 */
export async function executeAlreadyMergedFinalize(
  params: AlreadyMergedFinalizeParams,
): Promise<AlreadyMergedFinalizeResult> {
  const { id, title, doc } = params;

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} ${ALREADY_MERGED_LOG_TAG}: Finalize-only mode -- skipping merge phase`,
  );
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.INFO} Writing stamp, backlog, status, and events via micro-worktree...`,
  );

  try {
    await withMicroWorktree({
      operation: OPERATION_NAME,
      id,
      logPrefix: LOG_PREFIX.DONE,
      pushOnly: true,
      async execute({ worktreePath }) {
        const transaction = new WUTransaction(id);

        const wuPath = WU_PATHS.WU(id);
        const statusPath = WU_PATHS.STATUS();
        const backlogPath = WU_PATHS.BACKLOG();
        const stampPath = WU_PATHS.STAMP(id);

        await collectMetadataToTransaction({
          id,
          title,
          doc: { ...doc },
          wuPath,
          statusPath,
          backlogPath,
          stampPath,
          transaction,
          projectRoot: worktreePath,
        });

        // Write transaction files in the micro-worktree
        const files = transaction.getPendingWrites().map((w) => w.path);
        transaction.commit();

        const commitMessage = `wu(${id.toLowerCase()}): done - ${title} [already-merged]`;
        return { commitMessage, files };
      },
    });

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} ${ALREADY_MERGED_LOG_TAG}: Finalization complete`,
    );

    return {
      success: true,
      stamped: true,
      yamlUpdated: true,
      backlogUpdated: true,
      errors: [],
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
