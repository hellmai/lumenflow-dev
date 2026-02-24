#!/usr/bin/env node
// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Branch-Only mode completion workflow for wu:done
 * Extracted from wu-done.ts (WU-1215 refactoring)
 *
 * Flow:
 * 1. Switch to main branch
 * 2. Merge lane branch (if not --no-merge)
 * 3. Calculate paths relative to main checkout
 * 4. Update metadata files (WU YAML, status.md, backlog.md, stamp)
 * 5. Validate spec completeness
 * 6. Stage and format files
 * 7. Commit on main
 * 8. Push to origin
 */

import path from 'node:path';
import {
  defaultBranchFrom,
  branchExists,
  generateCommitMessage,
  updateMetadataFiles,
  collectMetadataToTransaction,
  stageAndFormatMetadata,
} from './wu-done-validators.js';
import { getGitForCwd } from './git-adapter.js';
import { readWU } from './wu-yaml.js';
import {
  BRANCHES,
  REMOTES,
  LOG_PREFIX,
  EMOJI,
  STRING_LITERALS,
  LUMENFLOW_PATHS,
  GIT_COMMANDS,
  GIT_FLAGS,
  WU_STATUS,
} from './wu-constants.js';
import { RECOVERY } from './wu-done-messages.js';
import { die, createError, ErrorCodes } from './error-handler.js';
import { validateWU, validateDoneWU } from './wu-schema.js';
import { assertTransition } from './state-machine.js';
import { detectZombieState, recoverZombieState } from './wu-recovery.js';
import { emit } from './telemetry.js';
import { withAtomicMerge } from './atomic-merge.js';
import { WUTransaction } from './wu-transaction.js';
// WU-1061: Import docs regeneration utilities
import { maybeRegenerateAndStageDocs } from './wu-done-docs-generate.js';
// WU-1492: Import PR creation utilities for branch-pr mode
import { createPR, printPRCreatedMessage, WU_DONE_COMPLETION_MODES } from './wu-done-pr.js';
import { createWuPaths } from './wu-paths.js';

export const LANE_SIGNALS_NDJSON = path.join(LUMENFLOW_PATHS.TELEMETRY, 'lane-signals.ndjson');

function resolveMetadataPaths(basePath: string, id: string) {
  const wuPaths = createWuPaths({ projectRoot: basePath });
  return {
    metadataWUPath: path.join(basePath, wuPaths.WU(id)),
    metadataStatusPath: path.join(basePath, wuPaths.STATUS()),
    metadataBacklogPath: path.join(basePath, wuPaths.BACKLOG()),
    metadataStampsDir: path.join(basePath, wuPaths.STAMPS_DIR()),
    metadataStampPath: path.join(basePath, wuPaths.STAMP(id)),
  };
}

interface LaneCompletionSignalParams {
  wuId: string;
  lane?: string;
  laneBranch?: string | null;
  completionMode: string;
  gitAdapter?: ReturnType<typeof getGitForCwd>;
  emitFn?: typeof emit;
}

/**
 * Parse git diff --name-only output into actual file paths.
 *
 * @param {string} diffOutput - Raw diff output
 * @returns {string[]} Parsed file paths
 */
export function parseActualFilesFromDiffOutput(diffOutput: UnsafeAny) {
  return String(diffOutput)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Collect actual changed files for lane telemetry emission.
 * Fail-open: returns [] if diff computation fails.
 *
 * @param {string|null|undefined} laneBranch - Lane branch name
 * @param {object} [gitAdapter] - Optional git adapter (test injection)
 * @returns {Promise<string[]>} List of changed files
 */
export async function collectActualFilesForLaneBranch(
  laneBranch: UnsafeAny,
  gitAdapter = getGitForCwd(),
) {
  if (!laneBranch) return [];
  try {
    const diffOutput = await gitAdapter.raw([
      GIT_COMMANDS.DIFF,
      '--name-only',
      `${BRANCHES.MAIN}...${laneBranch}`,
    ]);
    return parseActualFilesFromDiffOutput(diffOutput);
  } catch (error) {
    console.warn(
      `${LOG_PREFIX.DONE} Could not compute lane-signal actualFiles for ${laneBranch}: ${error.message}`,
    );
    return [];
  }
}

/**
 * Emit one lane-signal telemetry event (passive, fail-open).
 *
 * @param {object} params - Emission params
 * @param {string} params.wuId - WU ID
 * @param {string} [params.lane] - WU lane
 * @param {string|null} [params.laneBranch] - Lane branch
 * @param {string} params.completionMode - Completion path mode
 * @param {object} [params.gitAdapter] - Optional git adapter (test injection)
 * @param {function} [params.emitFn] - Optional emit function (test injection)
 * @returns {Promise<void>}
 */
export async function emitLaneSignalForCompletion({
  wuId,
  lane,
  laneBranch,
  completionMode,
  gitAdapter = getGitForCwd(),
  emitFn = emit,
}: LaneCompletionSignalParams) {
  try {
    const actualFiles = await collectActualFilesForLaneBranch(laneBranch, gitAdapter);
    emitFn(LANE_SIGNALS_NDJSON, {
      timestamp: new Date().toISOString(),
      wuId,
      lane: lane ?? null,
      actualFiles,
      completionMode,
    });
  } catch (error) {
    console.warn(`${LOG_PREFIX.DONE} Lane-signal emission failed (fail-open): ${error.message}`);
  }
}

/**
 * @typedef {Object} BranchOnlyContext
 * @property {string} id - WU ID (e.g., "WU-1215")
 * @property {Object} args - Parsed CLI arguments
 * @property {Object} docMain - WU YAML document from main checkout
 * @property {string} title - WU title for commit message
 * @property {boolean} isDocsOnly - Whether this is a docs-only WU
 * @property {number} maxCommitLength - Max commit header length from commitlint
 * @property {function} recordTransactionState - Transaction state recorder
 * @property {function} rollbackTransaction - Transaction rollback function
 * @property {function} validateStagedFiles - Staged files validator
 */

/**
 * @typedef {Object} BranchOnlyResult
 * @property {boolean} success - Whether completion succeeded
 * @property {boolean} committed - Whether changes were committed
 * @property {boolean} pushed - Whether changes were pushed
 * @property {boolean} merged - Whether lane branch was merged
 */

/**
 * Execute branch-only mode completion
 *
 * @param {BranchOnlyContext} context - Branch-only mode context
 * @returns {Promise<BranchOnlyResult>} Completion result
 * @throws {Error} On validation or git operation failure
 */
export async function executeBranchOnlyCompletion(context: UnsafeAny) {
  const {
    id,
    args,
    docMain,
    title,
    isDocsOnly,
    maxCommitLength,
    recordTransactionState,
    rollbackTransaction,
    validateStagedFiles,
  } = context;

  let merged = false;
  const laneBranch = await defaultBranchFrom(docMain);

  // Step 1: Use atomic merge path for branch-only non-PR completion.
  // This keeps live main untouched while merge/push and metadata commit execute.
  const gitAdapter = getGitForCwd();
  if (!args.noMerge && laneBranch && (await branchExists(laneBranch))) {
    await withAtomicMerge({
      id,
      laneBranch,
      operation: 'wu-done-branch-only',
      logPrefix: LOG_PREFIX.DONE,
      command: `pnpm wu:done --id ${id}`,
      afterMerge: async ({ worktreePath, gitWorktree }) => {
        const metadataBasePath = worktreePath;
        const {
          metadataWUPath,
          metadataStatusPath,
          metadataBacklogPath,
          metadataStampsDir,
          metadataStampPath,
        } = resolveMetadataPaths(metadataBasePath, id);
        const docForUpdate = readWU(metadataWUPath, id);
        const currentStatus = (docForUpdate.status as string) || WU_STATUS.IN_PROGRESS;

        assertTransition(currentStatus, WU_STATUS.DONE, id);

        const schemaResult = validateWU(docForUpdate);
        if (!schemaResult.success) {
          const errors = schemaResult.error.issues.map(
            (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
          );
          throw createError(
            ErrorCodes.VALIDATION_ERROR,
            `WU YAML validation failed:\n${errors.join(STRING_LITERALS.NEWLINE)}`,
            { wuId: id },
          );
        }

        const completenessResult = validateDoneWU(docForUpdate);
        if (!completenessResult.valid) {
          throw createError(
            ErrorCodes.VALIDATION_ERROR,
            `Cannot mark WU as done - spec incomplete:\n  ${completenessResult.errors.join('\n  ')}`,
            { wuId: id },
          );
        }

        const transaction = new WUTransaction(id);
        await collectMetadataToTransaction({
          id,
          title,
          doc: docForUpdate,
          wuPath: metadataWUPath,
          statusPath: metadataStatusPath,
          backlogPath: metadataBacklogPath,
          stampPath: metadataStampPath,
          transaction,
          projectRoot: metadataBasePath,
        });
        const txCommitResult = transaction.commit();
        if (!txCommitResult.success) {
          throw createError(
            ErrorCodes.TRANSACTION_ERROR,
            `Atomic metadata write failed for ${id}: ${txCommitResult.failed.map((entry) => entry.path).join(', ')}`,
            { wuId: id },
          );
        }

        await maybeRegenerateAndStageDocs({
          baseBranch: BRANCHES.MAIN,
          repoRoot: metadataBasePath,
        });

        await stageAndFormatMetadata({
          id,
          wuPath: metadataWUPath,
          statusPath: metadataStatusPath,
          backlogPath: metadataBacklogPath,
          stampsDir: metadataStampsDir,
          gitAdapter: gitWorktree,
          repoRoot: metadataBasePath,
        });

        await validateStagedFiles(id, isDocsOnly);

        const msg = generateCommitMessage(id, title, maxCommitLength, {
          branch: laneBranch,
        });
        await gitWorktree.commit(msg);
        console.log(
          `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Metadata committed in atomic temp worktree`,
        );
      },
    });

    merged = true;

    await emitLaneSignalForCompletion({
      wuId: id,
      lane: docMain.lane,
      laneBranch,
      completionMode: WU_DONE_COMPLETION_MODES.BRANCH_ONLY,
      gitAdapter,
    });

    return { success: true, committed: true, pushed: true, merged };
  }

  // Legacy fallback path for --no-merge or missing lane branch.
  if (!args.noMerge) {
    console.log(
      `${LOG_PREFIX.DONE} No lane branch found (${laneBranch || 'unknown'}), skipping merge`,
    );
    await gitAdapter.checkout(BRANCHES.MAIN);
  } else {
    console.log(`\n${LOG_PREFIX.DONE} Switching to ${BRANCHES.MAIN} for completion commit...`);
    await gitAdapter.checkout(BRANCHES.MAIN);
  }

  // Step 2: Calculate paths relative to main checkout
  const metadataBasePath = '.';
  const {
    metadataWUPath,
    metadataStatusPath,
    metadataBacklogPath,
    metadataStampsDir,
    metadataStampPath,
  } = resolveMetadataPaths(metadataBasePath, id);

  // Step 3: Read WU YAML and validate current state
  const docForUpdate = readWU(metadataWUPath, id);
  const currentStatus = (docForUpdate.status as string) || 'in_progress';

  // Check for zombie state (recovery mode)
  if (detectZombieState(docForUpdate, null)) {
    await recoverZombieState({ id, doc: docForUpdate, _worktreePath: undefined, _args: args });
    console.log(`\n${RECOVERY.SUCCESS}`);
    console.log(`- WU: ${id} — ${title}`);
    return { success: true, committed: false, pushed: false, merged, recovered: true };
  }

  // Validate state transition
  try {
    assertTransition(currentStatus, WU_STATUS.DONE, id);
  } catch (error) {
    die(`State transition validation failed: ${error.message}`);
  }

  // Step 4: Record transaction state for atomic rollback
  const transactionState = recordTransactionState(
    id,
    metadataWUPath,
    metadataStampPath,
    metadataBacklogPath,
    metadataStatusPath,
  );
  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Transaction BEGIN - state recorded for rollback (WU YAML + backlog + status)`,
  );

  try {
    // Step 5: Validate spec completeness
    const schemaResult = validateWU(docForUpdate);
    if (!schemaResult.success) {
      const errors = schemaResult.error.issues.map(
        (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
      );
      die(`WU YAML validation failed:\n${errors.join(STRING_LITERALS.NEWLINE)}`);
    }

    const completenessResult = validateDoneWU(docForUpdate);
    if (!completenessResult.valid) {
      die(`Cannot mark WU as done - spec incomplete:\n  ${completenessResult.errors.join('\n  ')}`);
    }

    // Step 6: Update metadata files
    // WU-1572: Now async for state store integration
    await updateMetadataFiles({
      id,
      title,
      doc: docForUpdate,
      wuPath: metadataWUPath,
      statusPath: metadataStatusPath,
      backlogPath: metadataBacklogPath,
    });

    // WU-1061: Regenerate docs if doc-source files changed
    // This runs BEFORE stageAndFormatMetadata to include doc outputs
    // in the single atomic commit
    await maybeRegenerateAndStageDocs({
      baseBranch: BRANCHES.MAIN,
      repoRoot: metadataBasePath,
    });

    // Step 7: Stage and format files
    await stageAndFormatMetadata({
      id,
      wuPath: metadataWUPath,
      statusPath: metadataStatusPath,
      backlogPath: metadataBacklogPath,
      stampsDir: metadataStampsDir,
    });

    // Validate staged files
    await validateStagedFiles(id, isDocsOnly);

    // Step 8: Commit on main
    const msg = generateCommitMessage(id, title, maxCommitLength, {
      branch: laneBranch ?? undefined,
    });
    const gitCwd = getGitForCwd();
    await gitCwd.commit(msg);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Metadata committed on main`);

    // Step 9: Sync/rebase before push (handles concurrent main advancement)
    await gitAdapter.raw([GIT_COMMANDS.PULL, GIT_FLAGS.REBASE, REMOTES.ORIGIN, BRANCHES.MAIN]);
    // Step 10: Push to origin
    await gitAdapter.push(REMOTES.ORIGIN, BRANCHES.MAIN);
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pushed to ${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);

    // WU-1498: Passive lane telemetry (fail-open)
    await emitLaneSignalForCompletion({
      wuId: id,
      lane: docForUpdate.lane as string | undefined,
      laneBranch,
      completionMode: WU_DONE_COMPLETION_MODES.BRANCH_ONLY,
      gitAdapter,
    });

    return { success: true, committed: true, pushed: true, merged };
  } catch (err) {
    // Atomic rollback on failure
    await rollbackTransaction(
      transactionState,
      metadataWUPath,
      metadataStampPath,
      metadataBacklogPath,
      metadataStatusPath,
    );

    // Re-throw with context
    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  WU:DONE FAILED (Branch-Only Mode)');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log(`║  Error: ${err.message}`);
    console.log('║');
    console.log('║  Transaction rolled back - WU remains not-done.');
    console.log('║');
    console.log('║  Recovery steps:');
    console.log('║  1. Fix the issue');
    console.log(`║  2. Retry: pnpm wu:done --id ${id}`);
    console.log('╚══════════════════════════════════════════════════════════════════╝');

    throw err;
  }
}

/**
 * @typedef {Object} BranchPRContext
 * @property {string} id - WU ID (e.g., "WU-1492")
 * @property {Object} args - Parsed CLI arguments
 * @property {Object} docMain - WU YAML document
 * @property {string} title - WU title for PR title
 * @property {string} laneBranch - Lane branch name
 * @property {boolean} isDocsOnly - Whether this is a docs-only WU
 * @property {number} maxCommitLength - Max commit header length
 * @property {function} validateStagedFiles - Staged files validator
 * @property {function} updateMetadata - Metadata update function
 * @property {function} stageMetadata - Metadata staging function
 */

/**
 * @typedef {Object} BranchPRResult
 * @property {boolean} success - Whether completion succeeded
 * @property {boolean} committed - Whether changes were committed
 * @property {boolean} pushed - Whether changes were pushed
 * @property {boolean} merged - Always false (branch-pr never merges to main)
 * @property {string|null} prUrl - URL of created PR
 */

/**
 * WU-1492: Execute branch-pr mode completion
 *
 * Branch-PR mode stays on the lane branch, commits metadata, pushes,
 * and creates a PR. It NEVER checks out main or merges.
 *
 * @param {BranchPRContext} context - Branch-PR mode context
 * @returns {Promise<BranchPRResult>} Completion result
 * @throws {Error} On validation or git operation failure
 */
export async function executeBranchPRCompletion(context: UnsafeAny) {
  const { id, args, docMain, title, laneBranch, isDocsOnly, maxCommitLength, validateStagedFiles } =
    context;

  console.log(`\n${LOG_PREFIX.DONE} Branch-PR mode: staying on ${laneBranch}`);
  console.log(`${LOG_PREFIX.DONE} Metadata will be committed on lane branch and PR created`);

  // Calculate paths relative to current checkout (lane branch)
  const metadataBasePath = '.';
  const { metadataWUPath, metadataStatusPath, metadataBacklogPath, metadataStampsDir } =
    resolveMetadataPaths(metadataBasePath, id);

  // Update metadata files on lane branch
  await updateMetadataFiles({
    id,
    title,
    doc: docMain,
    wuPath: metadataWUPath,
    statusPath: metadataStatusPath,
    backlogPath: metadataBacklogPath,
  });

  // Stage and format metadata
  await stageAndFormatMetadata({
    id,
    wuPath: metadataWUPath,
    statusPath: metadataStatusPath,
    backlogPath: metadataBacklogPath,
    stampsDir: metadataStampsDir,
  });

  // Validate staged files
  await validateStagedFiles(id, isDocsOnly);

  // Commit on lane branch (NOT main)
  const msg = generateCommitMessage(id, title, maxCommitLength, {
    branch: laneBranch,
  });
  const gitAdapter = getGitForCwd();
  await gitAdapter.commit(msg);
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Metadata committed on lane branch`);

  // Push lane branch to origin
  await gitAdapter.push(REMOTES.ORIGIN, laneBranch);
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Pushed to ${REMOTES.ORIGIN}/${laneBranch}`);

  // Create PR from lane branch to main
  const prResult = await createPR({
    branch: laneBranch,
    id,
    title,
    doc: docMain,
    draft: args.prDraft,
  });

  let prUrl = null;
  if (prResult.success && prResult.prUrl) {
    printPRCreatedMessage(prResult.prUrl, id);
    prUrl = prResult.prUrl;
  }

  // WU-1498: Passive lane telemetry (fail-open)
  await emitLaneSignalForCompletion({
    wuId: id,
    lane: docMain.lane,
    laneBranch,
    completionMode: WU_DONE_COMPLETION_MODES.BRANCH_PR,
    gitAdapter,
  });

  return { success: true, committed: true, pushed: true, merged: false, prUrl };
}
