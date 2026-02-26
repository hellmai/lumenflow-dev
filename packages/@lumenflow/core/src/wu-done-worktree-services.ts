// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-1664: Extracted wu:done worktree completion services for state-driven execution.
 *
 * Each exported service function corresponds to a pipeline state from the XState
 * wu:done machine (WU-1662). Services receive explicit dependencies and return
 * typed results, enabling the state-machine orchestrator (WU-1663) to invoke them
 * independently without changing branch-only or public completion semantics.
 *
 * Pipeline state mapping:
 *   validateWorktreeState  -> validating
 *   prepareTransaction     -> preparing
 *   commitTransaction      -> committing
 *   mergeToMain            -> merging + pushing (atomic merge combines both)
 *   finalizeCompletion     -> cleaningUp
 *
 * @module wu-done-worktree-services
 */

import path from 'node:path';
import {
  collectMetadataToTransaction,
  stageAndFormatMetadata,
  generateCommitMessage,
  defaultBranchFrom,
  branchExists,
  validatePostMutation,
} from './wu-done-validators.js';
import { validateDoneWU, validateAndNormalizeWUYAML } from './wu-schema.js';
import { assertTransition } from './state-machine.js';
import { validateMainNotBehindOrigin, resolveWorktreeMetadataPaths } from './wu-done-worktree.js';
import { emitLaneSignalForCompletion } from './wu-done-branch-only.js';
import { WU_DONE_COMPLETION_MODES } from './wu-done-pr.js';
import { clearRecoveryAttempts, detectZombieState } from './wu-recovery.js';
import {
  countPreviousCompletionAttempts,
  squashPreviousCompletionAttempts,
} from './wu-done-retry-helpers.js';
import { WUTransaction, createTransactionSnapshot, restoreFromSnapshot } from './wu-transaction.js';
import { maybeRegenerateAndStageDocs } from './wu-done-docs-generate.js';
import { withMergeLock } from './merge-lock.js';
import { withAtomicMerge } from './atomic-merge.js';
import { BRANCHES, LOG_PREFIX, WU_STATUS } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';
import { createValidationError } from './wu-done-errors.js';
import { createGitForPath } from './git-adapter.js';
import type { MainSyncGitAdapter } from './sync-validator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Common dependencies shared by worktree completion services.
 */
export interface WorktreeServiceDeps {
  /** Work unit ID (e.g., "WU-1664") */
  wuId: string;
  /** Absolute path to the worktree */
  worktreePath: string;
}

/**
 * Result of the validateWorktreeState service.
 */
export interface WorktreeValidationResult {
  /** Whether the worktree state is valid for completion */
  valid: boolean;
  /** Error messages if validation failed */
  errors: string[];
  /** Whether zombie state was detected (status=done in worktree) */
  zombieDetected: boolean;
  /** The normalized WU document (after auto-fix if applicable) */
  normalizedDoc?: Record<string, unknown>;
}

/**
 * Result of the prepareTransaction service.
 */
export interface PreparationResult {
  /** The WU transaction object (not yet committed) */
  transaction: WUTransaction;
  /** Relative paths for staged metadata files */
  stagedMetadataAllowlist: string[];
  /** Absolute path to the initiative metadata file (if applicable) */
  initiativeMetadataPath: string | null;
}

/**
 * Result of the commitTransaction service.
 */
export interface CommitResult {
  /** Whether the transaction and git commit succeeded */
  committed: boolean;
  /** SHA before the metadata commit (for rollback) */
  preCommitSha: string | null;
}

/**
 * Result of the mergeToMain service.
 */
export interface MergeResult {
  /** Whether the branch was merged to main */
  merged: boolean;
  /** PR URL if PR mode was used */
  prUrl: string | null;
}

/**
 * Result of the finalizeCompletion service.
 */
export interface FinalizationResult {
  /** Whether finalization completed */
  finalized: boolean;
}

// ---------------------------------------------------------------------------
// Service: validateWorktreeState (pipeline state: validating)
// ---------------------------------------------------------------------------

export interface ValidateWorktreeStateInput {
  wuId: string;
  worktreePath: string;
  /** WU document read from the worktree */
  doc: Record<string, unknown>;
  /** Absolute path to the main checkout (for main-behind-origin check) */
  mainCheckoutPath: string;
  /** Git adapter scoped to the main checkout */
  gitAdapterForMain?: MainSyncGitAdapter;
}

/**
 * Validate worktree state for wu:done completion.
 *
 * Checks:
 * 1. WU status can transition to done
 * 2. Local main is not behind origin/main
 * 3. WU YAML schema is valid and normalizable
 * 4. Done-specific completeness (acceptance, code_paths, etc.)
 * 5. Zombie state detection
 *
 * @param input - Validation inputs
 * @returns Validation result with error details
 */
export async function validateWorktreeState(
  input: ValidateWorktreeStateInput,
): Promise<WorktreeValidationResult> {
  const { wuId, worktreePath, doc, mainCheckoutPath, gitAdapterForMain } = input;
  const errors: string[] = [];
  let zombieDetected = false;

  // Check for zombie state (status=done in worktree)
  if (detectZombieState(doc, worktreePath)) {
    zombieDetected = true;
    // Zombie detection is informational; the caller decides how to handle it
    return { valid: true, errors: [], zombieDetected, normalizedDoc: doc };
  }

  // Validate state transition
  const currentStatus = (doc.status as string) || WU_STATUS.IN_PROGRESS;
  try {
    assertTransition(currentStatus, WU_STATUS.DONE, wuId);
  } catch (err) {
    errors.push(`State transition invalid: ${(err as Error).message}`);
    return { valid: false, errors, zombieDetected };
  }

  // Check main is not behind origin
  try {
    const mainGit = gitAdapterForMain ?? createGitForPath(mainCheckoutPath);
    const mainResult = await validateMainNotBehindOrigin(mainGit);
    if (!mainResult.valid) {
      errors.push(
        `Local main is ${mainResult.commitsBehind} commit(s) behind origin/main. ` +
          `Fix: git pull origin main`,
      );
      return { valid: false, errors, zombieDetected };
    }
  } catch {
    // Fail-open for network errors
  }

  // Validate and normalize WU YAML schema
  const normalizeResult = validateAndNormalizeWUYAML(doc);
  if (!normalizeResult.valid) {
    errors.push(`WU YAML validation failed: ${normalizeResult.errors.join('; ')}`);
    return { valid: false, errors, zombieDetected };
  }
  const normalizedDoc = normalizeResult.normalized ?? doc;

  // Validate done-specific completeness
  const completenessResult = validateDoneWU(normalizedDoc);
  if (!completenessResult.valid) {
    errors.push(`Spec incomplete: ${completenessResult.errors.join('; ')}`);
    return { valid: false, errors, zombieDetected };
  }

  return { valid: true, errors: [], zombieDetected, normalizedDoc };
}

// ---------------------------------------------------------------------------
// Service: prepareTransaction (pipeline state: preparing)
// ---------------------------------------------------------------------------

export interface PrepareTransactionInput {
  wuId: string;
  title: string;
  doc: Record<string, unknown>;
  worktreePath: string;
}

/**
 * Prepare the metadata transaction for wu:done completion.
 *
 * Collects all metadata changes (WU YAML, status, backlog, stamp, events)
 * into a WUTransaction without writing UnsafeAny files. The transaction can then
 * be committed atomically by the commitTransaction service.
 *
 * @param input - Preparation inputs
 * @returns Transaction and metadata allowlist
 */
export async function prepareTransaction(
  input: PrepareTransactionInput,
): Promise<PreparationResult> {
  const { wuId, title, doc, worktreePath } = input;

  const metaPaths = resolveWorktreeMetadataPaths(worktreePath, wuId);
  const transaction = new WUTransaction(wuId);

  await collectMetadataToTransaction({
    id: wuId,
    title,
    doc,
    wuPath: metaPaths.wuPath,
    statusPath: metaPaths.statusPath,
    backlogPath: metaPaths.backlogPath,
    stampPath: metaPaths.stampPath,
    transaction,
    projectRoot: worktreePath,
  });

  // Build the staged metadata allowlist from pending writes
  const pendingWrites = transaction.getPendingWrites();
  const stagedMetadataAllowlist = pendingWrites
    .map((write) => path.relative(worktreePath, write.path).split(path.sep).join('/'))
    .filter(
      (relativePath) =>
        Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath),
    );

  const initiativeMetadataWrite = pendingWrites.find(
    (write) => write.description === 'initiative YAML',
  );
  const initiativeMetadataPath = initiativeMetadataWrite?.path ?? null;

  // Validate the transaction
  const txValidation = transaction.validate();
  if (!txValidation.valid) {
    throw createError(
      ErrorCodes.TRANSACTION_ERROR,
      `Transaction validation failed:\n  ${txValidation.errors.join('\n  ')}`,
      { wuId },
    );
  }

  return { transaction, stagedMetadataAllowlist, initiativeMetadataPath };
}

// ---------------------------------------------------------------------------
// Service: commitTransaction (pipeline state: committing)
// ---------------------------------------------------------------------------

export interface CommitTransactionInput {
  wuId: string;
  title: string;
  transaction: WUTransaction;
  worktreePath: string;
  worktreeGit: {
    getCommitHash: (ref: string) => Promise<string>;
    commit: (msg: string) => Promise<unknown>;
    add: (files: string | string[]) => Promise<unknown>;
    raw: (args: string[]) => Promise<string>;
  };
  doc: Record<string, unknown>;
  maxCommitLength: number;
  isDocsOnly: boolean;
  stagedMetadataAllowlist: string[];
  initiativeMetadataPath?: string | null;
  validateStagedFiles: (
    id: string,
    isDocsOnly: boolean,
    options?: { metadataAllowlist?: string[] },
  ) => Promise<void>;
}

/**
 * Commit the metadata transaction and create a git commit in the worktree.
 *
 * Steps:
 * 1. Create a file snapshot (for rollback)
 * 2. Commit the transaction (write files)
 * 3. Run post-mutation validation
 * 4. Regenerate docs if needed
 * 5. Stage and format metadata
 * 6. Squash previous completion attempts
 * 7. Create the git commit
 *
 * @param input - Commit inputs
 * @returns Commit result with pre-commit SHA for rollback
 */
export async function commitTransaction(input: CommitTransactionInput): Promise<CommitResult> {
  const {
    wuId,
    title,
    transaction,
    worktreePath,
    worktreeGit,
    doc,
    maxCommitLength,
    isDocsOnly,
    stagedMetadataAllowlist,
    initiativeMetadataPath,
    validateStagedFiles,
  } = input;

  const metaPaths = resolveWorktreeMetadataPaths(worktreePath, wuId);

  // Snapshot for rollback
  const pathsToSnapshot = Array.from(
    new Set(transaction.getPendingWrites().map((write) => write.path)),
  );
  const transactionSnapshot = createTransactionSnapshot(pathsToSnapshot);

  // Atomic transaction commit (write files)
  const commitResult = transaction.commit();
  if (!commitResult.success) {
    throw createError(
      ErrorCodes.TRANSACTION_ERROR,
      `Transaction commit failed: ${commitResult.failed.map((f) => f.path).join(', ')}`,
      { wuId },
    );
  }

  // Post-mutation validation
  const postResult = validatePostMutation({
    id: wuId,
    wuPath: metaPaths.wuPath,
    stampPath: metaPaths.stampPath,
    eventsPath: metaPaths.eventsPath,
  });
  if (!postResult.valid) {
    // Rollback files on post-mutation failure
    restoreFromSnapshot(transactionSnapshot);
    throw createValidationError(
      `Post-mutation validation failed: ${postResult.errors.join('; ')}`,
      { wuId },
    );
  }

  // Regenerate docs
  await maybeRegenerateAndStageDocs({
    baseBranch: BRANCHES.MAIN,
    repoRoot: worktreePath,
  });

  // Stage and format metadata
  await stageAndFormatMetadata({
    id: wuId,
    wuPath: metaPaths.wuPath,
    statusPath: metaPaths.statusPath,
    backlogPath: metaPaths.backlogPath,
    stampsDir: metaPaths.stampsDir,
    initiativePath: initiativeMetadataPath ?? undefined,
    gitAdapter: worktreeGit,
    repoRoot: worktreePath,
  });

  // Validate staged files
  await validateStagedFiles(wuId, isDocsOnly, {
    metadataAllowlist: stagedMetadataAllowlist,
  });

  // Squash previous completion attempts (WU-1584)
  const previousAttempts = await countPreviousCompletionAttempts(wuId, worktreeGit);
  if (previousAttempts > 0) {
    await squashPreviousCompletionAttempts(wuId, previousAttempts, worktreeGit);
  }

  // Generate commit message and commit
  const laneBranch = await defaultBranchFrom(doc);
  const msg = generateCommitMessage(wuId, title, maxCommitLength, {
    branch: laneBranch ?? undefined,
    worktreePath,
  });
  const preCommitSha = await worktreeGit.getCommitHash('HEAD');
  await worktreeGit.commit(msg);

  return { committed: true, preCommitSha };
}

// ---------------------------------------------------------------------------
// Service: mergeToMain (pipeline state: merging + pushing)
// ---------------------------------------------------------------------------

export interface MergeToMainInput {
  wuId: string;
  doc: Record<string, unknown>;
  worktreePath: string;
  args: {
    noMerge?: boolean;
    noAutoRebase?: boolean;
    prMode?: boolean;
    prDraft?: boolean;
  };
}

/**
 * Merge the lane branch to main (or create a PR in PR mode).
 *
 * Uses the atomic merge path which creates a temporary worktree for the
 * merge+push operation, keeping the live main checkout untouched.
 *
 * @param input - Merge inputs
 * @returns Merge result with PR URL if applicable
 */
export async function mergeToMain(input: MergeToMainInput): Promise<MergeResult> {
  const { wuId, doc, args } = input;

  if (args.noMerge) {
    return { merged: false, prUrl: null };
  }

  const laneBranch = await defaultBranchFrom(doc);
  if (!laneBranch || !(await branchExists(laneBranch))) {
    throw createError(ErrorCodes.BRANCH_ERROR, `Lane branch not found: ${laneBranch}`, {
      wuId,
      laneBranch,
    });
  }

  if (args.prMode) {
    // PR mode: import and use createPR
    const { createPR, printPRCreatedMessage } = await import('./wu-done-pr.js');
    const prResult = await createPR({
      branch: laneBranch,
      id: wuId,
      title: (doc.title as string) || wuId,
      doc,
      draft: args.prDraft,
    });
    const prUrl = prResult.success && prResult.prUrl ? prResult.prUrl : null;
    if (prUrl) {
      printPRCreatedMessage(prUrl, wuId);
    }
    return { merged: false, prUrl };
  }

  // Default mode: atomic merge + push
  await withMergeLock(wuId, async () => {
    await withAtomicMerge({
      id: wuId,
      laneBranch,
      command: `pnpm wu:done --id ${wuId}`,
      logPrefix: LOG_PREFIX.DONE,
    });
  });

  return { merged: true, prUrl: null };
}

// ---------------------------------------------------------------------------
// Service: finalizeCompletion (pipeline state: cleaningUp)
// ---------------------------------------------------------------------------

export interface FinalizeCompletionInput {
  wuId: string;
  doc: Record<string, unknown>;
  laneBranch: string | null;
}

/**
 * Finalize the completion by clearing recovery state and emitting telemetry.
 *
 * @param input - Finalization inputs
 * @returns Finalization result
 */
export async function finalizeCompletion(
  input: FinalizeCompletionInput,
): Promise<FinalizationResult> {
  const { wuId, doc, laneBranch } = input;

  // Clear recovery attempts on successful completion
  clearRecoveryAttempts(wuId);

  // Passive lane telemetry (fail-open)
  await emitLaneSignalForCompletion({
    wuId,
    lane: doc.lane as string,
    laneBranch,
    completionMode: WU_DONE_COMPLETION_MODES.WORKTREE,
  });

  return { finalized: true };
}
