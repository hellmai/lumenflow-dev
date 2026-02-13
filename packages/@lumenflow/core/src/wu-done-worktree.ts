#!/usr/bin/env node

/**
 * Worktree mode completion workflow for wu:done
 * Extracted from wu-done.ts (WU-1215 refactoring)
 * Updated in WU-1369 to use atomic transaction pattern.
 *
 * Flow (WU-1369 Atomic Pattern):
 * 1. cd into worktree
 * 2. Read and validate WU state
 * 3. Run ALL validations FIRST (before any file writes)
 * 4. Collect all metadata changes into transaction (in memory)
 * 5. Commit transaction (atomic write)
 * 6. Stage and format files
 * 7. Git commit in worktree
 * 8. Return to main checkout
 * 9. Either merge (default) OR create PR (pr-mode)
 * 10. Push to origin
 *
 * Key guarantee: If any validation fails, NO files are modified.
 */

import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import {
  generateCommitMessage,
  collectMetadataToTransaction,
  stageAndFormatMetadata,
  defaultBranchFrom,
  branchExists,
  validatePostMutation,
} from './wu-done-validators.js';
import { getGitForCwd, createGitForPath } from './git-adapter.js';
import { readWU, writeWU } from './wu-yaml.js';
import { WU_PATHS } from './wu-paths.js';
import {
  BRANCHES,
  REMOTES,
  THRESHOLDS,
  LOG_PREFIX,
  EMOJI,
  COMMIT_FORMATS,
  BOX,
  STRING_LITERALS,
  WU_STATUS,
  GIT_COMMANDS,
  GIT_FLAGS,
  LUMENFLOW_PATHS,
} from './wu-constants.js';
import { RECOVERY, REBASE, PREFLIGHT, MERGE } from './wu-done-messages.js';
import { getDriftLevel, DRIFT_LEVELS } from './branch-drift.js';
import { createError, ErrorCodes } from './error-handler.js';
import { createRecoveryError, createValidationError } from './wu-done-errors.js';
import { validateDoneWU, validateAndNormalizeWUYAML } from './wu-schema.js';
import { validateCodePathsCommittedBeforeDone } from './wu-done-validation.js';
import { assertTransition } from './state-machine.js';
import { emitLaneSignalForCompletion } from './wu-done-branch-only.js';
import { WU_DONE_COMPLETION_MODES } from './wu-done-pr.js';
import {
  detectZombieState,
  resetWorktreeYAMLForRecovery,
  getRecoveryAttemptCount,
  incrementRecoveryAttempt,
  clearRecoveryAttempts,
  shouldEscalateToManualIntervention,
  MAX_RECOVERY_ATTEMPTS,
} from './wu-recovery.js';
import { isPRModeEnabled, createPR, printPRCreatedMessage } from './wu-done-pr.js';
import { isBranchAlreadyMerged } from './wu-done-branch-utils.js';
// WU-1371: Import rebase artifact cleanup functions
import { detectRebasedArtifacts, cleanupRebasedArtifacts } from './rebase-artifact-cleanup.js';
// WU-1061: Import docs regeneration utilities
import {
  maybeRegenerateAndStageDocs,
  DOC_OUTPUT_FILES,
  formatDocOutputs,
} from './wu-done-docs-generate.js';
import { WUTransaction, createTransactionSnapshot, restoreFromSnapshot } from './wu-transaction.js';
// WU-1506: Import backlog invariant repair
// WU-1574: Removed repairBacklogInvariants - no longer needed with state store architecture
// Backlog.md is now always regenerated from wu-events.jsonl, so duplicates cannot occur
// WU-1584: Import retry helpers for squashing duplicate commits
// WU-1749: Added prepareRecoveryWithSquash for zombie recovery flow
import {
  countPreviousCompletionAttempts,
  squashPreviousCompletionAttempts,
  prepareRecoveryWithSquash,
} from './wu-done-retry-helpers.js';
// WU-1747: Import retry, lock, and checkpoint modules for concurrent load resilience
import { withRetry, createRetryConfig } from './retry-strategy.js';
import { withMergeLock } from './merge-lock.js';
import { withAtomicMerge } from './atomic-merge.js';
import {} from './wu-checkpoint.js';
// WU-1749: Import state store constant for append-only file path
import { WU_EVENTS_FILE_NAME } from './wu-state-store.js';
import { validateWUEvent } from './wu-state-schema.js';

/**
 * @typedef {Object} WorktreeContext
 * @property {string} id - WU ID (e.g., "WU-1215")
 * @property {Object} args - Parsed CLI arguments
 * @property {Object} docMain - WU YAML document from main checkout
 * @property {string} title - WU title for commit message
 * @property {boolean} isDocsOnly - Whether this is a docs-only WU
 * @property {string} worktreePath - Path to worktree
 * @property {number} maxCommitLength - Max commit header length from commitlint
 * @property {function} validateStagedFiles - Staged files validator
 * NOTE: recordTransactionState/rollbackTransaction removed in WU-1369 (atomic pattern)
 */

/**
 * @typedef {Object} WorktreeResult
 * @property {boolean} success - Whether completion succeeded
 * @property {boolean} committed - Whether changes were committed
 * @property {boolean} pushed - Whether changes were pushed
 * @property {boolean} merged - Whether lane branch was merged (vs PR created)
 * @property {string|null} prUrl - PR URL if PR mode was used
 * @property {boolean} [recovered] - Whether zombie state was recovered
 * @property {boolean} [cleanupSafe] - WU-1811: Whether worktree cleanup is safe (all steps succeeded)
 */

interface WorktreeMetadataPaths {
  wuPath: string;
  statusPath: string;
  backlogPath: string;
  stampsDir: string;
  stampPath: string;
  eventsPath: string;
}

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

/**
 * Execute worktree mode completion
 *
 * @param {WorktreeContext} context - Worktree mode context
 * @returns {Promise<WorktreeResult>} Completion result
 * @throws {Error} On validation or git operation failure
 */
export async function executeWorktreeCompletion(context) {
  // Save original cwd for returning after any worktree operations.
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
    // NOTE: recordTransactionState/rollbackTransaction removed in WU-1369 (atomic pattern)
  } = context;

  const worktreeMetadataPaths = resolveWorktreeMetadataPaths(worktreePath, id);
  const metadataWUPath = worktreeMetadataPaths.wuPath;

  // Read WU YAML and validate current state
  const docForUpdate = readWU(metadataWUPath, id);

  // Check for zombie state (recovery mode)
  // WU-1440: If zombie state detected, reset worktree YAML to in_progress
  // and continue with normal flow (don't commit directly to main)
  if (detectZombieState(docForUpdate, worktreePath)) {
    console.log(`\n${RECOVERY.DETECTED}`);

    // WU-1335: Check recovery attempt count to prevent infinite loops
    const attemptCount = getRecoveryAttemptCount(id);
    if (shouldEscalateToManualIntervention(attemptCount)) {
      console.log(`\n${BOX.TOP}`);
      console.log(`${BOX.SIDE}  RECOVERY LOOP DETECTED - MANUAL INTERVENTION REQUIRED`);
      console.log(BOX.MID);
      console.log(`${BOX.SIDE}  WU: ${id}`);
      console.log(
        `${BOX.SIDE}  Recovery attempts: ${attemptCount} (max: ${MAX_RECOVERY_ATTEMPTS})`,
      );
      console.log(BOX.SIDE);
      console.log(`${BOX.SIDE}  Automatic recovery has failed multiple times.`);
      console.log(`${BOX.SIDE}  Manual steps required:`);
      console.log(BOX.SIDE);
      console.log(`${BOX.SIDE}  1. cd ${worktreePath}`);
      console.log(`${BOX.SIDE}  2. Reset WU YAML status to in_progress manually`);
      console.log(`${BOX.SIDE}  3. git add && git commit`);
      console.log(`${BOX.SIDE}  4. Return to main and retry wu:done`);
      console.log(BOX.SIDE);
      console.log(`${BOX.SIDE}  Or reset the recovery counter:`);
      console.log(`${BOX.SIDE}  rm .lumenflow/recovery/${id}.recovery`);
      console.log(BOX.BOT);

      throw createRecoveryError(
        `Recovery loop detected for ${id} after ${attemptCount} attempts. Manual intervention required.`,
        { wuId: id, attemptCount, maxAttempts: MAX_RECOVERY_ATTEMPTS },
      );
    }

    // Increment attempt counter before trying recovery
    const newAttemptCount = incrementRecoveryAttempt(id);
    console.log(
      `${LOG_PREFIX.DONE} Recovery attempt ${newAttemptCount}/${MAX_RECOVERY_ATTEMPTS} (WU-1335)`,
    );

    console.log(RECOVERY.RESUMING);

    // WU-1749: Squash previous completion attempts before recovery
    // This prevents "rebase hell" where multiple completion commits accumulate
    // during failed retry attempts
    // WU-1541: Use createGitForPath instead of process.chdir
    try {
      const gitWorktree = createGitForPath(worktreePath);
      const squashResult = await prepareRecoveryWithSquash(id, gitWorktree);
      if (squashResult.squashedCount > 0) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Squashed ${squashResult.squashedCount} previous completion attempt(s)`,
        );
      }
    } catch (squashError) {
      // Non-fatal: Log and continue with recovery
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not squash previous attempts: ${squashError.message}`,
      );
    }

    console.log(
      `${LOG_PREFIX.DONE} WU-1440: Resetting worktree YAML to in_progress for recovery flow...`,
    );

    // Reset the worktree YAML to in_progress (mutates docForUpdate)
    resetWorktreeYAMLForRecovery({ worktreePath, id, doc: docForUpdate });

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Recovery reset complete - continuing normal flow`,
    );
    // Continue with normal flow - don't return early
    // docForUpdate is now status=in_progress, so normal flow will work
  }

  // Capture status AFTER potential zombie recovery reset
  const currentStatus = docForUpdate.status || WU_STATUS.IN_PROGRESS;

  // Validate state transition
  assertTransition(currentStatus, WU_STATUS.DONE, id);

  // WU-1577: Abort early if local main is behind origin/main.
  // This prevents metadata leaks: if merge succeeds but push fails because
  // main is behind, wu-events.jsonl/backlog/status would leak onto local main.
  // Must run BEFORE transaction to guarantee no files are modified.
  await ensureMainNotBehindOrigin(originalCwd, id);

  // WU-1369: Create atomic transaction for metadata updates
  // This ensures NO files are modified if any validation fails
  const transaction = new WUTransaction(id);
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Transaction BEGIN - atomic pattern (WU-1369)`);

  // Save original cwd for returning after worktree operations
  let merged = false;
  let prUrl = null;
  // WU-1943: Track pre-commit SHA and git commit state for rollback on merge failure
  let preCommitSha = null;
  let gitCommitMade = false;
  // WU-2310: Track snapshot for file rollback on git commit failure
  /** @type {Map<string, string|null>|null} */
  let transactionSnapshot = null;
  let stagedMetadataAllowlist: string[] = [];
  let initiativeMetadataPath: string | null = null;

  try {
    // WU-1541: Use explicit worktree paths and git adapter instead of process.chdir
    console.log(`\n${LOG_PREFIX.DONE} Updating metadata in worktree: ${worktreePath}`);
    const worktreeGit = createGitForPath(worktreePath);

    // WU-1563: Use absolute metadata paths rooted in worktreePath.
    const workingWUPath = worktreeMetadataPaths.wuPath;
    const workingStatusPath = worktreeMetadataPaths.statusPath;
    const workingBacklogPath = worktreeMetadataPaths.backlogPath;
    const workingStampsDir = worktreeMetadataPaths.stampsDir;
    const workingStampPath = worktreeMetadataPaths.stampPath;

    // ======================================================================
    // PHASE 1: RUN ALL VALIDATIONS FIRST (before any file writes)
    // WU-1369: This ensures no partial state on validation failure
    // WU-1811: Validate and normalize YAML before gates/merge
    // ======================================================================

    console.log(`${LOG_PREFIX.DONE} Running validations (no writes until all pass)...`);

    // WU-1811: Validate and normalize WU YAML schema with fixable corrections
    // This catches schema issues early and auto-fixes normalizable problems
    const normalizeResult = validateAndNormalizeWUYAML(docForUpdate);
    if (!normalizeResult.valid) {
      throw createValidationError(
        `WU YAML validation failed:\n  - ${normalizeResult.errors.join('\n  - ')}\n\nNext step: Fix the validation errors in ${workingWUPath} and rerun wu:done`,
        { wuId: id },
      );
    }

    // WU-1811: If normalizations were applied, write back to YAML file
    if (normalizeResult.wasNormalized) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} WU-1811: Applying auto-normalisations to WU YAML...`,
      );
      writeWU(workingWUPath, normalizeResult.normalized);
      // Update docForUpdate to use normalized data for subsequent processing
      Object.assign(docForUpdate, normalizeResult.normalized);
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU YAML normalised and saved`);
    }

    // Validate done-specific completeness (uses normalized data)
    const completenessResult = validateDoneWU(normalizeResult.normalized);
    if (!completenessResult.valid) {
      throw createValidationError(
        `Cannot mark WU as done - spec incomplete:\n  ${completenessResult.errors.join('\n  ')}\n\nNext step: Update ${workingWUPath} to meet completion requirements and rerun wu:done`,
        { wuId: id },
      );
    }

    // WU-1153: Validate code_paths are committed before metadata transaction
    // This prevents lost work from metadata rollbacks after code commits
    console.log(`${LOG_PREFIX.DONE} Checking code_paths commit status (WU-1153)...`);
    // WU-1541: Use worktreeGit (explicit baseDir) instead of getGitForCwd()
    const codePathsResult = await validateCodePathsCommittedBeforeDone(
      normalizeResult.normalized,
      worktreeGit,
      { abortOnFailure: false }, // Don't abort here, throw validation error instead
    );

    if (!codePathsResult.valid) {
      const errorMessage = await import('./wu-done-validation.js').then((m) =>
        m.buildCodePathsCommittedErrorMessage(id, codePathsResult.uncommittedPaths),
      );
      throw createValidationError(errorMessage, { wuId: id });
    }

    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} All validations passed`);

    // ======================================================================
    // PHASE 2: COLLECT ALL CHANGES TO TRANSACTION (in memory, no writes)
    // WU-1369: Atomic collection - all changes gathered before any writes
    // ======================================================================

    // WU-1574: Now async
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

    // Validate the transaction itself
    const txValidation = transaction.validate();
    if (!txValidation.valid) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Transaction validation failed:\n  ${txValidation.errors.join('\n  ')}`,
        { wuId: id },
      );
    }

    // ======================================================================
    // PHASE 3: ATOMIC COMMIT (write all files at once)
    // WU-1369: This is the only point where files are written
    // WU-2310: Capture snapshot BEFORE commit for rollback on git commit failure
    // ======================================================================

    // WU-2310: Capture file state before transaction commit
    // This allows rollback if git commit fails AFTER files are written
    // WU-1541: Use absolute path via worktree metadata paths instead of relative path after chdir
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

    // ======================================================================
    // WU-1617: POST-MUTATION VALIDATION
    // Verify files written by tx.commit() are valid (completed_at, locked, stamp)
    // ======================================================================

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

    // ======================================================================
    // PHASE 4: GIT OPERATIONS (stage, format, commit)
    // Files are now written - proceed with git operations
    // ======================================================================

    // ======================================================================
    // WU-1061: Regenerate docs if doc-source files changed
    // This runs BEFORE stageAndFormatMetadata to include doc outputs
    // in the single atomic commit
    // Uses main as base to detect changes introduced by this WU
    // ======================================================================
    await maybeRegenerateAndStageDocs({
      baseBranch: BRANCHES.MAIN,
      repoRoot: worktreePath,
    });

    // Stage and format files
    // WU-1541: Pass worktreeGit and worktreePath to avoid process.chdir dependency
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

    // Validate staged files
    await validateStagedFiles(id, isDocsOnly, { metadataAllowlist: stagedMetadataAllowlist });

    // ======================================================================
    // WU-1584 Fix #1: Squash previous completion attempts before new commit
    // This prevents N duplicate commits when wu:done is retried N times
    // WU-1541: Use worktreeGit (explicit baseDir) instead of getGitForCwd()
    // ======================================================================
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

    // Generate commit message and commit
    const msg = generateCommitMessage(id, title, maxCommitLength, {
      branch: laneBranch ?? undefined,
      worktreePath,
    });
    // WU-1943: Capture pre-commit SHA for rollback on merge failure
    preCommitSha = await worktreeGit.getCommitHash('HEAD');
    await worktreeGit.commit(msg);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Metadata committed in worktree`);

    // WU-1943: Track that git commit was made (needed for rollback decision)
    gitCommitMade = true;

    // WU-1541: No need to chdir back - we never changed directory

    // Determine if PR mode is enabled
    const prModeEnabled = isPRModeEnabled(docMain, args);

    if (!args.noMerge) {
      // Use docForUpdate (from worktree) for branch calculation - docMain may be incomplete (ref: WU-1280)
      if (laneBranch && (await branchExists(laneBranch))) {
        if (prModeEnabled) {
          // PR mode: Create PR instead of auto-merge
          const prResult = await createPR({
            branch: laneBranch,
            id,
            title,
            doc: docMain,
            draft: args.prDraft,
          });
          if (prResult.success && prResult.prUrl) {
            printPRCreatedMessage(prResult.prUrl, id);
            prUrl = prResult.prUrl;
          }
        } else {
          // Default mode: Auto-merge with pre-flight checks
          console.log(PREFLIGHT.RUNNING);

          // Check branch drift (WU-1370: graduated warnings)
          const commitsBehind = await checkBranchDrift(laneBranch);
          if (commitsBehind > 0) {
            const driftLevel = getDriftLevel(commitsBehind);
            if (driftLevel === DRIFT_LEVELS.WARNING) {
              console.log(PREFLIGHT.BRANCH_DRIFT_WARNING(commitsBehind));
            } else if (driftLevel === DRIFT_LEVELS.INFO) {
              console.log(PREFLIGHT.BRANCH_DRIFT_INFO(commitsBehind));
            } else if (driftLevel === DRIFT_LEVELS.OK) {
              // No message needed for OK level
              console.log(PREFLIGHT.BRANCH_BEHIND(commitsBehind, THRESHOLDS.BRANCH_DRIFT_MAX));
            }
            // ERROR level is handled by checkBranchDrift throwing an error
          }

          // Check if branch is already merged
          const alreadyMerged = await isBranchAlreadyMerged(laneBranch);
          if (alreadyMerged) {
            console.log(PREFLIGHT.ALREADY_MERGED);
            console.log(PREFLIGHT.ALREADY_MERGED_EXPLANATION);
          } else {
            // Check for divergence and conflicts (auto-rebase if enabled - WU-1303)
            // noAutoRebase is true when --no-auto-rebase flag is passed
            // WU-1371: Pass wuId for post-rebase artifact cleanup
            await checkBranchDivergence(laneBranch, {
              autoRebase: args.noAutoRebase !== true,
              worktreePath,
              wuId: id,
            });

            // WU-1384: Check for merge commits (GitHub requires linear history)
            // Must run AFTER divergence check, as divergence rebase may eliminate merge commits
            // Catches case where user did 'git merge main' instead of rebase
            // WU-1371: Pass wuId for post-rebase artifact cleanup
            await checkMergeCommits(laneBranch, {
              autoRebase: args.noAutoRebase !== true,
              worktreePath,
              wuId: id,
            });

            await checkMergeConflicts(laneBranch);

            // WU-1456: Check for empty merge (warn if no work commits)
            // WU-1460: Pass doc to enable code_paths blocker
            await checkEmptyMerge(laneBranch, docForUpdate);

            // WU-1574: Backlog repair removed - state store architecture eliminates duplicates
            // Backlog.md is always regenerated from wu-events.jsonl, not parsed/modified

            console.log(MERGE.STARTING(laneBranch));
            // WU-1628: Route merge+push through atomic temp-worktree path.
            await withMergeLock(id, async () => {
              await withAtomicMerge({
                id,
                laneBranch,
                command: `pnpm wu:done --id ${id}`,
                logPrefix: LOG_PREFIX.DONE,
              });
            });
            console.log(MERGE.ATOMIC_SUCCESS);
            merged = true;
            console.log(MERGE.PUSHED(REMOTES.ORIGIN, BRANCHES.MAIN));
          }
        }
      } else {
        // Branch not found - fail loudly (use docForUpdate which has complete lane info)
        console.error(`\n${BOX.TOP}`);
        console.error(`${BOX.SIDE}  MERGE FAILED: Lane branch not found`);
        console.error(BOX.MID);
        console.error(`${BOX.SIDE}  Expected branch: ${laneBranch || '(null)'}`);
        console.error(`${BOX.SIDE}  WU lane: "${docForUpdate.lane}"`);
        console.error(`${BOX.SIDE}  WU id: "${docForUpdate.id}"`);
        console.error(BOX.BOT);
        throw createError(ErrorCodes.BRANCH_ERROR, `Lane branch not found: ${laneBranch}`, {
          laneBranch,
          wuId: docForUpdate.id,
        });
      }
    }

    // WU-1335: Clear recovery attempts on successful completion
    clearRecoveryAttempts(id);

    // WU-1498: Passive lane telemetry (fail-open)
    await emitLaneSignalForCompletion({
      wuId: id,
      lane: docForUpdate.lane,
      laneBranch,
      completionMode: WU_DONE_COMPLETION_MODES.WORKTREE,
    });

    // WU-1811: All steps succeeded - worktree cleanup is safe
    return {
      success: true,
      committed: true,
      pushed: !prModeEnabled,
      merged,
      prUrl,
      cleanupSafe: true,
    };
  } catch (err) {
    // WU-1541: No need to restore directory - we never changed it

    // WU-1369: Atomic transaction pattern
    // - If error occurred BEFORE transaction.commit() → no files were written
    // - If error occurred AFTER transaction.commit() → files written, need manual recovery
    const wasCommitted = transaction.isCommitted;

    // WU-1811: Provide actionable single next step based on failure state
    if (!wasCommitted) {
      // Abort transaction (discards pending changes, no files were written)
      transaction.abort();
      console.log(`\n${BOX.TOP}`);
      console.log(`${BOX.SIDE}  WU:DONE FAILED - NO FILES MODIFIED (atomic pattern)`);
      console.log(BOX.MID);
      console.log(`${BOX.SIDE}  Error: ${err.message}`);
      console.log(BOX.SIDE);
      console.log(`${BOX.SIDE}  WU-1369: Transaction aborted before any writes.`);
      console.log(`${BOX.SIDE}  WU-1811: Worktree preserved for recovery.`);
      console.log(`${BOX.SIDE}  Worktree: ${worktreePath}`);
      console.log(BOX.MID);
      console.log(`${BOX.SIDE}  NEXT STEP: Fix the error and rerun:`);
      console.log(`${BOX.SIDE}    pnpm wu:done --id ${id}`);
      console.log(BOX.BOT);
    } else {
      // Transaction was committed but git operations failed
      // Files were written - need rollback or recovery

      // WU-2310: Rollback file changes if git commit failed (before branch commit was made)
      // This prevents zombie states where status=done but commit never happened
      let fileRollbackSuccess = false;
      if (!gitCommitMade && transactionSnapshot) {
        console.log(
          `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-2310: Git commit failed after transaction - rolling back files...`,
        );
        try {
          // WU-1541: restoreFromSnapshot uses absolute paths from the snapshot,
          // so no chdir needed - it writes to the correct worktree paths directly
          const rollbackResult = restoreFromSnapshot(transactionSnapshot);
          if (rollbackResult.errors.length === 0) {
            fileRollbackSuccess = true;
            console.log(
              `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU-2310: File rollback complete - ${rollbackResult.restored.length} files restored`,
            );
          } else {
            console.log(
              `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-2310: Partial file rollback - ${rollbackResult.restored.length} restored, ${rollbackResult.errors.length} failed`,
            );
            for (const e of rollbackResult.errors) {
              console.log(`${LOG_PREFIX.DONE}   ${EMOJI.FAILURE} ${e.path}: ${e.error}`);
            }
          }
        } catch (rollbackErr) {
          // Log but don't fail - rollback is best-effort
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-2310: File rollback error: ${rollbackErr.message}`,
          );
        }
      }

      // WU-1943: If git commit was made but merge failed, rollback the branch
      // This prevents zombie states where branch shows "done" but wasn't merged
      if (gitCommitMade && preCommitSha) {
        console.log(
          `\n${LOG_PREFIX.DONE} ${EMOJI.WARNING} Merge failed after git commit - attempting branch rollback...`,
        );
        try {
          // WU-1541: Use createGitForPath instead of chdir + getGitForCwd
          const gitWorktreeForRollback = createGitForPath(worktreePath);
          await rollbackBranchOnMergeFailure(gitWorktreeForRollback, preCommitSha, id);
        } catch (rollbackErr) {
          // Log but don't fail - rollback is best-effort
          console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Rollback error: ${rollbackErr.message}`);
        }
      }

      console.log(`\n${BOX.TOP}`);
      if (fileRollbackSuccess) {
        console.log(`${BOX.SIDE}  WU:DONE FAILED - FILES ROLLED BACK (WU-2310)`);
        console.log(BOX.MID);
        console.log(`${BOX.SIDE}  Error: ${err.message}`);
        console.log(BOX.SIDE);
        console.log(
          `${BOX.SIDE}  WU-2310: Transaction files were rolled back to pre-commit state.`,
        );
        console.log(`${BOX.SIDE}  Worktree is now consistent (status=in_progress, no stamp).`);
      } else {
        console.log(`${BOX.SIDE}  WU:DONE FAILED - PARTIAL STATE (post-transaction)`);
        console.log(BOX.MID);
        console.log(`${BOX.SIDE}  Error: ${err.message}`);
        console.log(BOX.SIDE);
        console.log(`${BOX.SIDE}  Metadata files were written, but git operations failed.`);
        if (gitCommitMade && preCommitSha) {
          console.log(`${BOX.SIDE}  WU-1943: Branch rolled back to pre-commit state.`);
        }
      }
      console.log(`${BOX.SIDE}  WU-1811: Worktree preserved for recovery.`);
      console.log(`${BOX.SIDE}  Worktree: ${worktreePath}`);
      console.log(BOX.MID);
      console.log(`${BOX.SIDE}  NEXT STEP: Rerun wu:done (idempotent recovery):`);
      console.log(`${BOX.SIDE}    pnpm wu:done --id ${id}`);
      console.log(BOX.BOT);
    }

    // WU-1811: Attach cleanupSafe flag to error for caller to check
    err.cleanupSafe = false;
    throw err;
  }
}

/**
 * Check for branch drift (commits behind main)
 * WU-755 pre-flight check
 *
 * @param {string} branch - Lane branch name
 * @returns {Promise<number>} Number of commits behind main
 */
export async function checkBranchDrift(branch) {
  const gitAdapter = getGitForCwd();
  try {
    const counts = await gitAdapter.revList([
      '--left-right',
      '--count',
      `${BRANCHES.MAIN}...${branch}`,
    ]);
    const [mainAhead] = counts.split(/\s+/).map(Number);

    if (mainAhead > THRESHOLDS.BRANCH_DRIFT_MAX) {
      throw createError(
        ErrorCodes.GIT_ERROR,
        PREFLIGHT.BRANCH_DRIFT_ERROR(
          mainAhead,
          THRESHOLDS.BRANCH_DRIFT_MAX,
          REMOTES.ORIGIN,
          BRANCHES.MAIN,
        ),
        { branch, commitsBehind: mainAhead, threshold: THRESHOLDS.BRANCH_DRIFT_MAX },
      );
    }

    return mainAhead;
  } catch (e) {
    if (e.code === ErrorCodes.GIT_ERROR) throw e;
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check branch drift: ${e.message}`);
    return 0;
  }
}

/**
 * List of append-only files that can be auto-resolved during rebase
 * WU-1749 Bug 3: These files can safely have conflicts resolved by keeping both additions
 *
 * Uses WU_PATHS constants and WU_EVENTS_FILE_NAME to avoid hardcoded path strings
 * that would break if paths are rearranged.
 */
const APPEND_ONLY_FILES = [
  // State store events file (append-only by design) - WU-1430: Use centralized constant
  path.join(LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME),
  // Status and backlog are generated from state store but may conflict during rebase
  WU_PATHS.STATUS(),
  WU_PATHS.BACKLOG(),
];

// WU-1430: Use centralized constant
const WU_EVENTS_PATH = path.join(LUMENFLOW_PATHS.STATE_DIR, WU_EVENTS_FILE_NAME);

function normalizeEventForKey(event) {
  const normalized = {};
  for (const key of Object.keys(event).sort()) {
    normalized[key] = event[key];
  }
  return normalized;
}

function parseWuEventsJsonl(content, sourceLabel) {
  const lines = String(content)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  return lines.map((line, index) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      throw new Error(
        `wu-events.jsonl ${sourceLabel} has malformed JSON on line ${index + 1}: ${error.message}`,
      );
    }

    const validation = validateWUEvent(parsed);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(
        `wu-events.jsonl ${sourceLabel} has invalid event on line ${index + 1}: ${issues}`,
      );
    }

    return { event: validation.data, line };
  });
}

async function resolveWuEventsJsonlConflict(gitCwd, filePath) {
  const ours = await gitCwd.raw(['show', `:2:${filePath}`]);
  const theirs = await gitCwd.raw(['show', `:3:${filePath}`]);

  const theirsEvents = parseWuEventsJsonl(theirs, 'theirs');
  const oursEvents = parseWuEventsJsonl(ours, 'ours');

  const seen = new Set();
  const mergedLines = [];

  for (const { event, line } of theirsEvents) {
    const key = JSON.stringify(normalizeEventForKey(event));
    if (seen.has(key)) continue;
    seen.add(key);
    mergedLines.push(line);
  }

  for (const { event, line } of oursEvents) {
    const key = JSON.stringify(normalizeEventForKey(event));
    if (seen.has(key)) continue;
    seen.add(key);
    mergedLines.push(line);
  }

  await writeFile(filePath, mergedLines.join('\n') + '\n', 'utf-8');
  await gitCwd.add(filePath);
}

/**
 * Auto-resolve conflicts in append-only files during rebase
 * WU-1749 Bug 3: Keeps both additions for append-only files
 *
 * @param {object} gitCwd - Git adapter instance
 * @returns {Promise<{resolved: boolean, files: string[]}>} Resolution result
 */
async function autoResolveAppendOnlyConflicts(gitCwd) {
  const resolvedFiles = [];

  try {
    // Get list of conflicted files
    const status = await gitCwd.getStatus();
    const conflictLines = status.split('\n').filter((line) => line.startsWith('UU '));

    for (const line of conflictLines) {
      const filePath = line.substring(3).trim();

      // Check if this is an append-only file
      const isAppendOnly = APPEND_ONLY_FILES.some(
        (appendFile) => filePath.endsWith(appendFile) || filePath.includes(appendFile),
      );

      if (isAppendOnly) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.INFO} Auto-resolving append-only conflict: ${filePath}`,
        );

        if (filePath.endsWith(WU_EVENTS_PATH) || filePath.includes(WU_EVENTS_PATH)) {
          // For the event log we must keep BOTH sides (loss breaks state machine).
          // Merge strategy: union by event identity (validated), prefer theirs ordering then ours additions.
          await resolveWuEventsJsonlConflict(gitCwd, filePath);
        } else {
          // Backlog/status are derived; prefer main's version during rebase and regenerate later.
          await gitCwd.raw(['checkout', '--theirs', filePath]);
          await gitCwd.add(filePath);
        }
        resolvedFiles.push(filePath);
      }
    }

    return { resolved: resolvedFiles.length > 0, files: resolvedFiles };
  } catch (error) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Could not auto-resolve conflicts: ${error.message}`,
    );
    return { resolved: false, files: [] };
  }
}

/**
 * Auto-rebase branch onto main
 * WU-1303: Auto-rebase on wu:done to handle diverged branches automatically
 * WU-1371: Added wuId parameter for post-rebase artifact cleanup
 * WU-1749 Bug 3: Auto-resolve append-only file conflicts during rebase
 *
 * @param {string} branch - Lane branch name
 * @param {string} worktreePath - Path to worktree
 * @param {string} [wuId] - WU ID for artifact cleanup (e.g., 'WU-1371')
 * @returns {Promise<{success: boolean, error?: string}>} Rebase result
 */
export async function autoRebaseBranch(branch, worktreePath, wuId) {
  console.log(REBASE.STARTING(branch, BRANCHES.MAIN));

  // WU-1541: Use explicit baseDir instead of process.chdir for git operations
  const gitWorktree = createGitForPath(worktreePath);
  const previousEditor = process.env.GIT_EDITOR;
  process.env.GIT_EDITOR = 'true';

  try {
    // Fetch latest main (using worktree git context)
    await gitWorktree.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);

    // Attempt rebase
    try {
      await gitWorktree.rebase(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);
    } catch (rebaseError) {
      // WU-1749 Bug 3: Check if conflicts are in append-only files that can be auto-resolved
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.INFO} Rebase hit conflicts, checking for auto-resolvable...`,
      );

      const resolution = await autoResolveAppendOnlyConflicts(gitWorktree);

      if (resolution.resolved) {
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Auto-resolved ${resolution.files.length} append-only conflict(s)`,
        );

        // Continue the rebase after resolving conflicts
        try {
          await gitWorktree.raw(['rebase', '--continue']);
        } catch (continueError) {
          // May need multiple rounds of conflict resolution
          // For simplicity, we'll try once more
          const secondResolution = await autoResolveAppendOnlyConflicts(gitWorktree);
          if (secondResolution.resolved) {
            await gitWorktree.raw(['rebase', '--continue']);
          } else {
            // Still have non-auto-resolvable conflicts
            throw continueError;
          }
        }
      } else {
        // No auto-resolvable conflicts - rethrow original error
        throw rebaseError;
      }
    }

    // WU-1371: Detect and cleanup rebased completion artifacts
    // After rebase, check if main's completion artifacts (stamps, status=done)
    // were pulled into the worktree. These must be cleaned before continuing.
    // WU-1817: Now passes gitCwd to verify artifacts exist on origin/main
    if (wuId) {
      const artifacts = await detectRebasedArtifacts(worktreePath, wuId, gitWorktree);
      if (artifacts.hasArtifacts) {
        console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Detected rebased completion artifacts`);
        const cleanup = await cleanupRebasedArtifacts(worktreePath, wuId);
        if (cleanup.cleaned) {
          // Stage and commit the cleanup
          await gitWorktree.add('.');
          await gitWorktree.commit(COMMIT_FORMATS.REBASE_ARTIFACT_CLEANUP(wuId));
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Cleaned rebased artifacts and committed`,
          );
        }
      }
    }

    // WU-1657: Reconcile generated docs after rebase to avoid format-check loops.
    // A rebase can pull generated docs changes from main that need regeneration and/or formatting.
    if (wuId) {
      const docsResult = await maybeRegenerateAndStageDocs({
        baseBranch: `${REMOTES.ORIGIN}/${BRANCHES.MAIN}`,
        repoRoot: worktreePath,
      });

      if (!docsResult.regenerated) {
        const changedDocOutputs = await gitWorktree.raw([
          'diff',
          '--name-only',
          `${REMOTES.ORIGIN}/${BRANCHES.MAIN}...HEAD`,
          '--',
          ...DOC_OUTPUT_FILES,
        ]);

        if (changedDocOutputs.trim().length > 0) {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.INFO} Reconciling rebased generated docs outputs...`,
          );
          formatDocOutputs(worktreePath);
          await gitWorktree.add([...DOC_OUTPUT_FILES]);
        }
      }

      const stagedDocOutputs = await gitWorktree.raw([
        'diff',
        '--cached',
        '--name-only',
        '--',
        ...DOC_OUTPUT_FILES,
      ]);

      if (stagedDocOutputs.trim().length > 0) {
        await gitWorktree.commit(COMMIT_FORMATS.REBASE_ARTIFACT_CLEANUP(wuId));
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Committed rebased generated docs reconciliation`,
        );
      }
    }

    // Force-push lane branch with lease (safe force push)
    await gitWorktree.raw(['push', '--force-with-lease', REMOTES.ORIGIN, branch]);

    console.log(REBASE.SUCCESS);
    return { success: true };
  } catch (e) {
    // Rebase failed (likely conflicts) - abort and report
    console.error(REBASE.FAILED(e.message));

    try {
      // Abort the failed rebase to leave worktree clean
      await gitWorktree.raw(['rebase', '--abort']);
      console.log(REBASE.ABORTED);
    } catch {
      // Ignore abort errors - may already be clean
    }

    return {
      success: false,
      error: REBASE.MANUAL_FIX(worktreePath, REMOTES.ORIGIN, BRANCHES.MAIN, branch),
    };
  } finally {
    if (previousEditor === undefined) {
      delete process.env.GIT_EDITOR;
    } else {
      process.env.GIT_EDITOR = previousEditor;
    }
  }
}

/**
 * Check for branch divergence (main has advanced since branch creation)
 * WU-1303: Added autoRebase option (default ON) to automatically rebase diverged branches
 * WU-1371: Added wuId option for post-rebase artifact cleanup
 *
 * @param {string} branch - Lane branch name
 * @param {CheckBranchOptions} [options] - Check options
 * @throws {Error} If divergence detected and auto-rebase fails or is disabled
 */
interface CheckBranchOptions {
  /** Automatically rebase if diverged */
  autoRebase?: boolean;
  /** Path to worktree (required if autoRebase=true) */
  worktreePath?: string | null;
  /** WU ID for artifact cleanup (e.g., 'WU-1371') */
  wuId?: string | null;
}

export async function checkBranchDivergence(branch, options: CheckBranchOptions = {}) {
  const { autoRebase = true, worktreePath = null, wuId = null } = options;
  const gitAdapter = getGitForCwd();

  try {
    const mergeBase = await gitAdapter.mergeBase(BRANCHES.MAIN, branch);
    const mainHead = await gitAdapter.getCommitHash(BRANCHES.MAIN);

    if (mergeBase !== mainHead) {
      const mainCommitsAhead = await gitAdapter.revList([
        '--count',
        `${mergeBase}..${BRANCHES.MAIN}`,
      ]);
      const commitCount = Number(mainCommitsAhead);

      console.log(PREFLIGHT.DIVERGENCE_DETECTED(commitCount));

      // Attempt auto-rebase if enabled and worktree path provided
      if (autoRebase && worktreePath) {
        const rebaseResult = await autoRebaseBranch(branch, worktreePath, wuId);
        if (rebaseResult.success) {
          // Rebase succeeded - continue with wu:done
          return;
        }

        // Rebase failed - throw with detailed instructions
        throw createError(ErrorCodes.GIT_ERROR, rebaseResult.error, {
          branch,
          mergeBase,
          mainHead,
          mainCommitsAhead: commitCount,
          autoRebaseAttempted: true,
        });
      }

      // Auto-rebase disabled or no worktree path - throw with manual instructions
      throw createError(
        ErrorCodes.GIT_ERROR,
        PREFLIGHT.DIVERGENCE_ERROR(commitCount, REMOTES.ORIGIN, BRANCHES.MAIN, branch),
        { branch, mergeBase, mainHead, mainCommitsAhead: commitCount },
      );
    }

    console.log(PREFLIGHT.NO_DIVERGENCE);
  } catch (e) {
    if (e.code === ErrorCodes.GIT_ERROR) throw e;
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check branch divergence: ${e.message}`);
  }
}

/**
 * Check for merge commits in lane branch that would violate linear history
 * WU-1384: GitHub requires linear history; merge commits in lane branches must be eliminated
 * WU-1371: Added wuId option for post-rebase artifact cleanup
 *
 * If merge commits are found, triggers auto-rebase to linearize history.
 *
 * @param {string} branch - Lane branch name
 * @param {CheckBranchOptions} [options] - Check options
 * @throws {Error} If merge commits found and auto-rebase fails or is disabled
 */
export async function checkMergeCommits(branch, options: CheckBranchOptions = {}) {
  const { autoRebase = true, worktreePath = null, wuId = null } = options;
  const gitAdapter = getGitForCwd();

  try {
    // Find merge commits in lane branch that are not in main
    // --merges: only merge commits
    // main..branch: commits in branch not reachable from main
    const mergeCommitsRaw = await gitAdapter.raw([
      'rev-list',
      '--merges',
      `${BRANCHES.MAIN}..${branch}`,
    ]);

    const mergeCommits = mergeCommitsRaw.trim().split(STRING_LITERALS.NEWLINE).filter(Boolean);
    const mergeCount = mergeCommits.length;

    if (mergeCount > 0) {
      console.log(PREFLIGHT.MERGE_COMMITS_DETECTED(mergeCount));

      // Trigger rebase to eliminate merge commits
      if (autoRebase && worktreePath) {
        console.log(PREFLIGHT.MERGE_COMMITS_REBASING);
        const rebaseResult = await autoRebaseBranch(branch, worktreePath, wuId);
        if (rebaseResult.success) {
          // Rebase succeeded - merge commits eliminated
          return;
        }

        // Rebase failed - throw with detailed instructions
        throw createError(ErrorCodes.GIT_ERROR, rebaseResult.error, {
          branch,
          mergeCommitCount: mergeCount,
          autoRebaseAttempted: true,
        });
      }

      // Auto-rebase disabled or no worktree path - throw with manual instructions
      throw createError(
        ErrorCodes.GIT_ERROR,
        `Branch ${branch} contains ${mergeCount} merge commit(s).\n\n` +
          `GitHub requires linear history. Merge commits must be eliminated.\n\n` +
          `REQUIRED: Rebase your branch to linearize history:\n` +
          `  1. cd into your worktree\n` +
          `  2. git fetch ${REMOTES.ORIGIN} ${BRANCHES.MAIN}\n` +
          `  3. git rebase ${REMOTES.ORIGIN}/${BRANCHES.MAIN}\n` +
          `  4. git push --force-with-lease ${REMOTES.ORIGIN} ${branch}\n` +
          `  5. Return to main checkout and retry`,
        { branch, mergeCommitCount: mergeCount },
      );
    }

    console.log(PREFLIGHT.NO_MERGE_COMMITS);
  } catch (e) {
    if (e.code === ErrorCodes.GIT_ERROR) throw e;
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check for merge commits: ${e.message}`);
  }
}

/**
 * Check for merge conflicts using git merge-tree
 * WU-755 pre-flight check
 *
 * @param {string} branch - Lane branch name
 */
export async function checkMergeConflicts(branch) {
  const gitAdapter = getGitForCwd();
  try {
    const mergeBase = await gitAdapter.mergeBase(BRANCHES.MAIN, branch);
    const result = await gitAdapter.mergeTree(mergeBase, BRANCHES.MAIN, branch);

    if (result.includes('<<<<<<<') || result.includes('>>>>>>>')) {
      throw createError(
        ErrorCodes.GIT_ERROR,
        PREFLIGHT.CONFLICT_ERROR(REMOTES.ORIGIN, BRANCHES.MAIN),
        {
          branch,
          operation: 'merge-tree',
        },
      );
    }

    console.log(PREFLIGHT.NO_CONFLICTS);
  } catch (e) {
    if (e.code === ErrorCodes.GIT_ERROR) throw e;
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check merge conflicts: ${e.message}`);
  }
}

/**
 * WU-1456: Check for empty merge (no work commits beyond claim)
 * WU-1460: Upgraded to BLOCK when code_paths defined but files not modified
 *
 * Detects when an agent runs wu:done without committing actual work.
 * - If code_paths defined: BLOCK if those files weren't modified
 * - If no code_paths: WARNING only (docs-only or metadata updates are valid)
 *
 * @param {string} branch - Lane branch name
 * @param {object} [doc] - WU document with code_paths array (optional for backwards compatibility)
 * @returns {Promise<void>}
 * @throws {Error} When code_paths defined but files not modified in commits
 */
export async function checkEmptyMerge(branch, doc = null) {
  const gitAdapter = getGitForCwd();
  try {
    // Count commits on lane branch that are not in main
    const commitCountRaw = await gitAdapter.raw([
      'rev-list',
      '--count',
      `${BRANCHES.MAIN}..${branch}`,
    ]);
    const commitCount = Number(commitCountRaw.trim());

    // WU-1460: If code_paths defined, verify those files were modified
    const codePaths = doc?.code_paths || [];
    const hasCodePaths = Array.isArray(codePaths) && codePaths.length > 0;

    if (hasCodePaths) {
      // Get list of files modified in lane branch commits
      const modifiedFilesRaw = await gitAdapter.raw([
        'diff',
        '--name-only',
        `${BRANCHES.MAIN}...${branch}`,
      ]);
      const modifiedFiles = modifiedFilesRaw.trim().split('\n').filter(Boolean);

      // Check if any code_paths files are in the modified list
      const missingCodePaths = codePaths.filter(
        (codePath) =>
          !modifiedFiles.some(
            (modified) => modified.includes(codePath) || codePath.includes(modified),
          ),
      );

      if (missingCodePaths.length > 0) {
        // BLOCK: code_paths defined but files not modified
        throw createValidationError(PREFLIGHT.CODE_PATHS_NOT_MODIFIED(missingCodePaths), {
          branch,
          codePaths,
          missingCodePaths,
          modifiedFiles,
        });
      }

      // All code_paths files were modified
      console.log(PREFLIGHT.CODE_PATHS_VERIFIED);
    } else if (commitCount <= 1) {
      // No code_paths - just warn (backwards compatible behaviour)
      // If only 0-1 commits beyond main, this is likely the claim commit only
      console.log(PREFLIGHT.EMPTY_MERGE_WARNING(commitCount));
    } else {
      console.log(PREFLIGHT.EMPTY_MERGE_CHECK);
    }
  } catch (e) {
    // Re-throw validation errors (WU-1460 blocker)
    if (e.code === ErrorCodes.VALIDATION_ERROR) throw e;
    console.warn(`${LOG_PREFIX.DONE} Warning: Could not check for empty merge: ${e.message}`);
  }
}

async function isMainAncestorOfBranch(gitAdapter, branch) {
  try {
    await gitAdapter.raw([GIT_COMMANDS.MERGE_BASE, GIT_FLAGS.IS_ANCESTOR, BRANCHES.MAIN, branch]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Merge lane branch to main with exponential backoff retry (WU-1747)
 *
 * Uses retry strategy to handle concurrent completions gracefully.
 * WU-1749 Bug 2: Will auto-rebase lane branch onto new main on retry.
 *
 * @param {string} branch - Lane branch name
 * @param {Object} [options] - Merge options
 * @param {MergeLaneBranchOptions} [options] - Merge options
 * @throws {Error} On merge failure after all retries
 */
interface MergeLaneBranchOptions extends CheckBranchOptions {
  /** Override max retry attempts */
  maxAttempts?: number;
}

export async function mergeLaneBranch(branch, options: MergeLaneBranchOptions = {}) {
  const gitAdapter = getGitForCwd();
  console.log(MERGE.BRANCH_MERGE(branch));

  // WU-1747: Use exponential backoff retry for merge operations
  // WU-1749 Bug 2: Now rebases lane branch on retry instead of just pulling main
  const retryConfig = createRetryConfig('wu_done', {
    maxAttempts: options.maxAttempts,
    onRetry: async (attempt, error, _delay) => {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Merge attempt ${attempt} failed: ${error.message}`,
      );

      // WU-1749 Bug 2: Rebase lane branch onto new main instead of just pulling
      // This is required because ff-only merge will always fail if the lane branch
      // is still based on the old main after main has advanced
      if (options.worktreePath) {
        const mainIsAncestor = await isMainAncestorOfBranch(gitAdapter, branch);
        if (mainIsAncestor) {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.INFO} Main is already an ancestor - skipping auto-rebase`,
          );
          return;
        }

        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.INFO} Auto-rebasing lane branch onto latest main...`,
        );
        const rebaseResult = await autoRebaseBranch(branch, options.worktreePath, options.wuId);
        if (rebaseResult.success) {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Lane branch rebased - ff-only merge should succeed`,
          );
        } else {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Auto-rebase failed: ${rebaseResult.error}`,
          );
          // Fall back to pull --rebase for consistent linear-history sync
          try {
            await gitAdapter.raw([
              GIT_COMMANDS.PULL,
              GIT_FLAGS.REBASE,
              '--autostash',
              REMOTES.ORIGIN,
              BRANCHES.MAIN,
            ]);
            console.log(MERGE.UPDATED_MAIN(REMOTES.ORIGIN));
          } catch (pullErr) {
            console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Pull also failed: ${pullErr.message}`);
          }
        }
      } else {
        // No worktree path - pull --rebase before retry
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.INFO} Pulling latest main with --rebase before retry...`,
        );
        try {
          await gitAdapter.raw([
            GIT_COMMANDS.PULL,
            GIT_FLAGS.REBASE,
            '--autostash',
            REMOTES.ORIGIN,
            BRANCHES.MAIN,
          ]);
          console.log(MERGE.UPDATED_MAIN(REMOTES.ORIGIN));
        } catch (pullErr) {
          console.log(
            `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Pull failed: ${pullErr.message} - will retry anyway`,
          );
        }
      }
    },
  });

  try {
    await withRetry(async () => {
      await gitAdapter.merge(branch, { ffOnly: true });
    }, retryConfig);

    console.log(MERGE.SUCCESS(branch));
  } catch (e) {
    // All retries exhausted
    const mainIsAncestor = await isMainAncestorOfBranch(gitAdapter, branch);
    const message = mainIsAncestor
      ? MERGE.FF_FAILED_NON_DIVERGED_ERROR(branch, e.message)
      : MERGE.FF_DIVERGED_ERROR(branch, e.message);
    throw createError(ErrorCodes.GIT_ERROR, message, {
      branch,
      originalError: e.message,
      retriesExhausted: true,
      mainIsAncestor,
    });
  }
}

/**
 * WU-1943: Check if the session has checkpoints for the given WU
 *
 * Used to warn agents when they're completing a WU without any checkpoints,
 * which means no recovery data if the session crashes.
 *
 * @param {string} wuId - WU ID to check
 * @param {Array|null} nodes - Memory nodes for the WU (from queryByWu)
 * @returns {boolean} True if checkpoints exist, false otherwise
 */
export function hasSessionCheckpoints(wuId, nodes) {
  if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
    return false;
  }

  return nodes.some((node) => node.type === 'checkpoint');
}

/**
 * WU-1943: Rollback branch to pre-commit SHA when merge fails
 *
 * When wu:done commits metadata to the lane branch but the subsequent merge
 * to main fails, this function rolls back the branch to its pre-commit state.
 * This prevents "zombie" states where the branch shows done but wasn't merged.
 *
 * @param {object} gitAdapter - Git adapter instance (must be in worktree context)
 * @param {string} preCommitSha - SHA to reset to (captured before metadata commit)
 * @param {string} wuId - WU ID for logging
 * @returns {Promise<{success: boolean, error?: string}>} Rollback result
 */
export async function rollbackBranchOnMergeFailure(gitAdapter, preCommitSha, wuId) {
  try {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-1943: Rolling back ${wuId} branch to pre-commit state...`,
    );

    // WU-2236: GitAdapter.reset expects (ref: string, options?: { hard?: boolean })
    // NOT an array like ['--hard', sha]
    await gitAdapter.reset(preCommitSha, { hard: true });

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} WU-1943: Branch rollback complete for ${wuId}`,
    );

    return { success: true };
  } catch (error) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} WU-1943: Could not rollback branch for ${wuId}: ${error.message}`,
    );

    return { success: false, error: error.message };
  }
}

/**
 * WU-1577: Validate that local main is not behind origin/main before transaction.
 *
 * Defense-in-depth check inside the core layer. The CLI layer already has
 * `ensureMainUpToDate()`, but this adds a guard directly before the
 * transaction starts in `executeWorktreeCompletion()`. This prevents
 * metadata leaks when the merge succeeds but the subsequent push fails
 * because main was behind.
 *
 * Fail-open: if the fetch or comparison fails (network issue), returns valid=true
 * to avoid blocking legitimate work when there's no remote.
 *
 * @param gitAdapter - Git adapter instance (must be in main checkout context)
 * @returns Validation result with commitsBehind count
 */
export async function validateMainNotBehindOrigin(
  gitAdapter,
): Promise<{ valid: boolean; commitsBehind: number; failOpen?: boolean }> {
  try {
    await gitAdapter.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);

    const localSha = await gitAdapter.getCommitHash(BRANCHES.MAIN);
    const remoteSha = await gitAdapter.getCommitHash(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);

    if (localSha === remoteSha) {
      return { valid: true, commitsBehind: 0 };
    }

    const behindRaw = await gitAdapter.revList([
      '--count',
      `${BRANCHES.MAIN}..${REMOTES.ORIGIN}/${BRANCHES.MAIN}`,
    ]);
    const commitsBehind = Number(behindRaw.trim()) || 0;

    if (commitsBehind > 0) {
      return { valid: false, commitsBehind };
    }

    // Local is ahead of remote (not behind) — valid
    return { valid: true, commitsBehind: 0 };
  } catch {
    // Fail-open: network error or no remote — allow wu:done to proceed
    return { valid: true, commitsBehind: 0, failOpen: true };
  }
}

/**
 * WU-1577: Helper that throws if local main is behind origin.
 * Extracted from executeWorktreeCompletion to keep cognitive complexity in check.
 */
async function ensureMainNotBehindOrigin(mainCheckoutPath: string, wuId: string): Promise<void> {
  const gitMainPreCheck = createGitForPath(mainCheckoutPath);
  const result = await validateMainNotBehindOrigin(gitMainPreCheck);
  if (!result.valid) {
    throw createError(
      ErrorCodes.GIT_ERROR,
      `Local main is ${result.commitsBehind} commit(s) behind origin/main.\n\n` +
        `wu:done aborted BEFORE any writes to prevent metadata leaks (WU-1577).\n\n` +
        `Fix: git pull origin main\n` +
        `Then retry: pnpm wu:done --id ${wuId}`,
      { wuId, commitsBehind: result.commitsBehind },
    );
  }
}
