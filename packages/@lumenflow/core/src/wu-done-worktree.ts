#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Worktree mode completion orchestrator for wu:done (WU-1369 atomic pattern).
 * Decomposed in WU-2014: pre-flight checks, merge/rebase, error handling,
 * zombie recovery, and main-sync validation extracted into focused modules.
 *
 * Key guarantee: If validation fails, NO files are modified.
 */

import path from 'node:path';
import {
  generateCommitMessage,
  collectMetadataToTransaction,
  stageAndFormatMetadata,
  defaultBranchFrom,
  validatePostMutation,
} from './wu-done-validators.js';
import { createGitForPath } from './git-adapter.js';
import { readWU, writeWU } from './wu-yaml.js';
import { WU_PATHS } from './wu-paths.js';
import { BRANCHES, LOG_PREFIX, EMOJI, WU_STATUS, LUMENFLOW_PATHS } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';
import { createValidationError } from './wu-done-errors.js';
import { validateDoneWU, validateAndNormalizeWUYAML } from './wu-schema.js';
import { validateCodePathsCommittedBeforeDone } from './wu-done-validation.js';
import { assertTransition } from './state-machine.js';
import { emitLaneSignalForCompletion } from './wu-done-branch-only.js';
import { WU_DONE_COMPLETION_MODES } from './wu-done-pr.js';
import { clearRecoveryAttempts } from './wu-recovery.js';
import { WUTransaction, createTransactionSnapshot } from './wu-transaction.js';
import {
  countPreviousCompletionAttempts,
  squashPreviousCompletionAttempts,
} from './wu-done-retry-helpers.js';
import { WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import { maybeRegenerateAndStageDocs } from './wu-done-docs-generate.js';

// WU-2014: Import from extracted modules
import { assertNoConflictArtifactsInIndex } from './wu-done-rebase.js';
import { handleZombieRecovery } from './wu-done-zombie-recovery.js';
import { handleCompletionError } from './wu-done-error-handling.js';
import { ensureMainNotBehindOrigin } from './wu-done-main-sync.js';
import { executeMergePhase } from './wu-done-merge-phase.js';

// Re-exports for backwards compatibility (WU-2014)
// Consumers import these symbols from '@lumenflow/core/wu-done-worktree'

export {
  checkBranchDrift,
  checkBranchDivergence,
  checkMergeCommits,
  checkMergeConflicts,
  checkEmptyMerge,
} from './wu-done-preflight-checks.js';
export type { CheckBranchOptions } from './wu-done-preflight-checks.js';
export {
  autoRebaseBranch,
  assertNoConflictArtifactsInIndex,
  autoResolveAppendOnlyConflicts,
} from './wu-done-rebase.js';
export { mergeLaneBranch, isMainAncestorOfBranch } from './wu-done-merge.js';
export type { MergeLaneBranchOptions } from './wu-done-merge.js';
export { hasSessionCheckpoints, rollbackBranchOnMergeFailure } from './wu-done-utils.js';
export { handleZombieRecovery } from './wu-done-zombie-recovery.js';
export { handleCompletionError } from './wu-done-error-handling.js';
export type { CompletionErrorContext } from './wu-done-error-handling.js';
export { validateMainNotBehindOrigin } from './wu-done-main-sync.js';

export { executeMergePhase } from './wu-done-merge-phase.js';
export type { MergePhaseContext, MergePhaseResult } from './wu-done-merge-phase.js';

// Types

interface WorktreeMetadataPaths {
  wuPath: string;
  statusPath: string;
  backlogPath: string;
  stampsDir: string;
  stampPath: string;
  eventsPath: string;
}

interface DoneArgs {
  noMerge?: boolean;
  prDraft?: boolean;
  noAutoRebase?: boolean;
  [key: string]: unknown;
}

interface WorktreeDoc {
  id?: string;
  lane?: string;
  code_paths?: string[];
  [key: string]: unknown;
}

type ValidateStagedFilesFn = (
  id: string,
  isDocsOnly: boolean,
  options: { metadataAllowlist: string[] },
) => Promise<void> | void;

interface WorktreeCompletionContext {
  id: string;
  args: DoneArgs;
  docMain: WorktreeDoc;
  title: string;
  isDocsOnly: boolean;
  worktreePath: string;
  maxCommitLength: number;
  validateStagedFiles: ValidateStagedFilesFn;
}

interface WorktreeCompletionResult {
  success: boolean;
  committed: boolean;
  pushed: boolean;
  merged: boolean;
  prUrl: string | null;
  recovered?: boolean;
  cleanupSafe?: boolean;
}

// Path resolution

/**
 * Resolve all metadata/state paths as absolute worktree-local paths.
 *
 * WU-1563: Prevents wu:done from writing lifecycle metadata into main checkout
 * when worktree mode is active.
 */
export function resolveWorktreeMetadataPaths(
  worktreePath: string,
  id: string,
): WorktreeMetadataPaths {
  return {
    wuPath: path.join(worktreePath, WU_PATHS.WU(id)),
    statusPath: path.join(worktreePath, WU_PATHS.STATUS()),
    backlogPath: path.join(worktreePath, WU_PATHS.BACKLOG()),
    stampsDir: path.join(worktreePath, WU_PATHS.STAMPS_DIR()),
    stampPath: path.join(worktreePath, WU_PATHS.STAMP(id)),
    eventsPath: path.join(worktreePath, LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME),
  };
}

// Main orchestrator

/**
 * Execute worktree mode completion
 *
 * @param context - Worktree mode context
 * @returns Completion result
 * @throws On validation or git operation failure
 */
export async function executeWorktreeCompletion(
  context: WorktreeCompletionContext,
): Promise<WorktreeCompletionResult> {
  // Save original cwd for returning after worktree operations.
  // This must be captured BEFORE zombie recovery, which temporarily chdirs into the worktree.
  const originalCwd = process.cwd();

  const {
    id,
    args,
    docMain,
    title,
    isDocsOnly,
    worktreePath,
    maxCommitLength,
    validateStagedFiles,
  } = context;

  const worktreeMetadataPaths = resolveWorktreeMetadataPaths(worktreePath, id);

  // Read WU YAML and validate current state
  const docForUpdate = readWU(worktreeMetadataPaths.wuPath, id);

  // WU-2014: Zombie recovery delegated to wu-done-zombie-recovery.ts
  await handleZombieRecovery(docForUpdate, worktreePath, id);

  // Capture status AFTER potential zombie recovery reset
  const currentStatus = (docForUpdate.status as string) || WU_STATUS.IN_PROGRESS;
  assertTransition(currentStatus, WU_STATUS.DONE, id);

  // WU-1577: Abort early if local main is behind origin/main.
  await ensureMainNotBehindOrigin(originalCwd, id);

  // WU-1369: Create atomic transaction for metadata updates
  const transaction = new WUTransaction(id);
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Transaction BEGIN - atomic pattern (WU-1369)`);

  let preCommitSha = null;
  let gitCommitMade = false;
  let transactionSnapshot = null;
  let stagedMetadataAllowlist: string[];
  let initiativeMetadataPath: string | null;

  try {
    console.log(`\n${LOG_PREFIX.DONE} Updating metadata in worktree: ${worktreePath}`);
    const worktreeGit = createGitForPath(worktreePath);

    const workingWUPath = worktreeMetadataPaths.wuPath;
    const workingStatusPath = worktreeMetadataPaths.statusPath;
    const workingBacklogPath = worktreeMetadataPaths.backlogPath;
    const workingStampsDir = worktreeMetadataPaths.stampsDir;
    const workingStampPath = worktreeMetadataPaths.stampPath;

    // PHASE 1: RUN ALL VALIDATIONS FIRST (before file writes)
    console.log(`${LOG_PREFIX.DONE} Running validations (no writes until all pass)...`);

    const normalizeResult = validateAndNormalizeWUYAML(docForUpdate);
    if (!normalizeResult.valid) {
      throw createValidationError(
        `WU YAML validation failed:\n  - ${normalizeResult.errors.join('\n  - ')}\n\nNext step: Fix the validation errors in ${workingWUPath} and rerun wu:done`,
        { wuId: id },
      );
    }

    if (normalizeResult.wasNormalized) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} WU-1811: Applying auto-normalisations to WU YAML...`,
      );
      writeWU(workingWUPath, normalizeResult.normalized);
      Object.assign(docForUpdate, normalizeResult.normalized);
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU YAML normalised and saved`);
    }

    const normalizedWU = normalizeResult.normalized ?? docForUpdate;
    const completenessResult = validateDoneWU(normalizedWU);
    if (!completenessResult.valid) {
      throw createValidationError(
        `Cannot mark WU as done - spec incomplete:\n  ${completenessResult.errors.join('\n  ')}\n\nNext step: Update ${workingWUPath} to meet completion requirements and rerun wu:done`,
        { wuId: id },
      );
    }

    console.log(`${LOG_PREFIX.DONE} Checking code_paths commit status (WU-1153)...`);
    const codePathsResult = await validateCodePathsCommittedBeforeDone(normalizedWU, worktreeGit, {
      abortOnFailure: false,
    });

    if (!codePathsResult.valid) {
      const errorMessage = await import('./wu-done-validation.js').then((m) =>
        m.buildCodePathsCommittedErrorMessage(id, codePathsResult.uncommittedPaths),
      );
      throw createValidationError(errorMessage, { wuId: id });
    }

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} All validations passed`);

    // PHASE 2: COLLECT ALL CHANGES TO TRANSACTION
    await collectMetadataToTransaction({
      id,
      title,
      doc: docForUpdate,
      wuPath: workingWUPath,
      statusPath: workingStatusPath,
      backlogPath: workingBacklogPath,
      stampPath: workingStampPath,
      transaction,
      projectRoot: worktreePath,
    });

    const pendingWrites = transaction.getPendingWrites();
    stagedMetadataAllowlist = pendingWrites
      .map((write) => path.relative(worktreePath, write.path).split(path.sep).join('/'))
      .filter(
        (relativePath) =>
          Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath),
      );
    const initiativeMetadataWrite = pendingWrites.find(
      (write) => write.description === 'initiative YAML',
    );
    initiativeMetadataPath = initiativeMetadataWrite?.path ?? null;

    const txValidation = transaction.validate();
    if (!txValidation.valid) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Transaction validation failed:\n  ${txValidation.errors.join('\n  ')}`,
        { wuId: id },
      );
    }

    // PHASE 3: ATOMIC COMMIT (write all files at once)
    const workingEventsPath = worktreeMetadataPaths.eventsPath;
    const pathsToSnapshot = Array.from(
      new Set(transaction.getPendingWrites().map((write) => write.path)),
    );
    transactionSnapshot = createTransactionSnapshot(pathsToSnapshot);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.INFO} WU-2310: Snapshot captured for rollback`);

    const commitResult = transaction.commit();
    if (!commitResult.success) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Transaction commit failed - some files not written:\n  ${commitResult.failed.map((f) => f.path).join('\n  ')}`,
        { wuId: id, written: commitResult.written, failed: commitResult.failed },
      );
    }

    // WU-1617: POST-MUTATION VALIDATION
    const postMutationResult = validatePostMutation({
      id,
      wuPath: workingWUPath,
      stampPath: workingStampPath,
      eventsPath: workingEventsPath,
    });

    if (!postMutationResult.valid) {
      throw createValidationError(
        `Post-mutation validation failed:\n  ${postMutationResult.errors.join('\n  ')}`,
        { wuId: id, errors: postMutationResult.errors },
      );
    }

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Post-mutation validation passed (WU-1617)`);

    // PHASE 4: GIT OPERATIONS (stage, format, commit)
    await maybeRegenerateAndStageDocs({
      baseBranch: BRANCHES.MAIN,
      repoRoot: worktreePath,
    });

    await stageAndFormatMetadata({
      id,
      wuPath: workingWUPath,
      statusPath: workingStatusPath,
      backlogPath: workingBacklogPath,
      stampsDir: workingStampsDir,
      initiativePath: initiativeMetadataPath,
      gitAdapter: worktreeGit,
      repoRoot: worktreePath,
    });

    await validateStagedFiles(id, isDocsOnly, { metadataAllowlist: stagedMetadataAllowlist });

    // WU-1584: Squash previous completion attempts
    const previousAttempts = await countPreviousCompletionAttempts(id, worktreeGit);
    if (previousAttempts > 0) {
      const squashResult = await squashPreviousCompletionAttempts(
        id,
        previousAttempts,
        worktreeGit,
      );
      if (squashResult.squashed) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU-1584: Squashed ${squashResult.count} previous attempt(s) - single commit will be created`,
        );
      }
    }

    const laneBranch = await defaultBranchFrom(docForUpdate);

    const msg = generateCommitMessage(id, title, maxCommitLength, {
      branch: laneBranch ?? undefined,
      worktreePath,
    });
    await assertNoConflictArtifactsInIndex(worktreeGit);
    preCommitSha = await worktreeGit.getCommitHash('HEAD');
    await worktreeGit.commit(msg);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Metadata committed in worktree`);

    gitCommitMade = true;

    // WU-2014: Merge/PR phase delegated to wu-done-merge-phase.ts
    const mergeResult = await executeMergePhase({
      id,
      title,
      laneBranch,
      docMain,
      docForUpdate,
      args,
      worktreePath,
    });

    clearRecoveryAttempts(id); // WU-1335: Clear recovery attempts on success
    await emitLaneSignalForCompletion({
      wuId: id,
      lane: docForUpdate.lane as string | undefined,
      laneBranch,
      completionMode: WU_DONE_COMPLETION_MODES.WORKTREE,
    });

    return {
      success: true,
      committed: true,
      pushed: !mergeResult.prModeEnabled,
      merged: mergeResult.merged,
      prUrl: mergeResult.prUrl,
      cleanupSafe: true,
    };
  } catch (err: unknown) {
    // WU-2014: Error handling extracted to wu-done-error-handling.ts
    // handleCompletionError always throws (Promise<never>); return satisfies TS control-flow
    return await handleCompletionError({
      error: err,
      id,
      worktreePath,
      transaction,
      gitCommitMade,
      preCommitSha,
      transactionSnapshot,
    });
  }
}
