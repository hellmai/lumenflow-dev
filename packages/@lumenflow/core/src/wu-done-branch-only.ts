#!/usr/bin/env node

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
} from './wu-constants.js';
import { RECOVERY } from './wu-done-messages.js';
import { die, createError, ErrorCodes } from './error-handler.js';
import { validateWU, validateDoneWU } from './wu-schema.js';
import { assertTransition } from './state-machine.js';
import { detectZombieState, recoverZombieState } from './wu-recovery.js';
// WU-1061: Import docs regeneration utilities
import { maybeRegenerateAndStageDocs } from './wu-done-docs-generate.js';

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
export async function executeBranchOnlyCompletion(context) {
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

  // Step 1: Switch to main and optionally merge lane branch
  const gitAdapter = getGitForCwd();
  if (!args.noMerge) {
    if (laneBranch && (await branchExists(laneBranch))) {
      console.log(`\n${LOG_PREFIX.DONE} Switching to ${BRANCHES.MAIN} for merge...`);
      await gitAdapter.checkout(BRANCHES.MAIN);
      await mergeLaneBranch(laneBranch);
      merged = true;
    } else {
      console.log(
        `${LOG_PREFIX.DONE} No lane branch found (${laneBranch || 'unknown'}), skipping merge`,
      );
      await gitAdapter.checkout(BRANCHES.MAIN);
    }
  } else {
    console.log(`\n${LOG_PREFIX.DONE} Switching to ${BRANCHES.MAIN} for completion commit...`);
    await gitAdapter.checkout(BRANCHES.MAIN);
  }

  // Step 2: Calculate paths relative to main checkout
  const metadataBasePath = '.';
  const metadataWUPath = path.join(
    metadataBasePath,
    'docs',
    '04-operations',
    'tasks',
    'wu',
    `${id}.yaml`,
  );
  const metadataStatusPath = path.join(
    metadataBasePath,
    'docs',
    '04-operations',
    'tasks',
    'status.md',
  );
  const metadataBacklogPath = path.join(
    metadataBasePath,
    'docs',
    '04-operations',
    'tasks',
    'backlog.md',
  );
  const metadataStampsDir = path.join(metadataBasePath, LUMENFLOW_PATHS.STAMPS_DIR);
  const metadataStampPath = path.join(metadataStampsDir, `${id}.done`);

  // Step 3: Read WU YAML and validate current state
  const docForUpdate = readWU(metadataWUPath, id);
  const currentStatus = docForUpdate.status || 'in_progress';

  // Check for zombie state (recovery mode)
  if (detectZombieState(docForUpdate, null)) {
    await recoverZombieState({ id, doc: docForUpdate, _worktreePath: null, _args: args });
    console.log(`\n${RECOVERY.SUCCESS}`);
    console.log(`- WU: ${id} — ${title}`);
    return { success: true, committed: false, pushed: false, merged, recovered: true };
  }

  // Validate state transition
  try {
    assertTransition(currentStatus, 'done', id);
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
 * Merge lane branch to main with retry logic
 * Internal helper for branch-only mode
 *
 * @param {string} laneBranch - Lane branch name to merge
 * @throws {Error} On merge failure
 */
async function mergeLaneBranch(laneBranch) {
  console.log(`${LOG_PREFIX.DONE} Merging ${laneBranch} to main (ff-only)...`);
  const gitAdapter = getGitForCwd();

  try {
    // First attempt: fast-forward only
    await gitAdapter.merge(laneBranch, { ffOnly: true });
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Lane branch merged to main`);
  } catch (mergeErr) {
    // Retry with pull --rebase if ff-only fails (main may have advanced)
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Fast-forward merge failed: ${mergeErr.message}`,
    );
    console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Attempting pull --rebase + retry...`);
    try {
      await gitAdapter.raw([GIT_COMMANDS.PULL, GIT_FLAGS.REBASE, REMOTES.ORIGIN, BRANCHES.MAIN]);
      await gitAdapter.merge(laneBranch, { ffOnly: true });
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Lane branch merged after pull --rebase`);
    } catch (retryErr) {
      throw createError(
        ErrorCodes.GIT_ERROR,
        `Failed to merge lane branch ${laneBranch}: ${retryErr.message}\n` +
          `Suggestion: Rebase your lane branch on main and retry:\n` +
          `  cd worktrees/<lane>-<wu>; git rebase main`,
        { branch: laneBranch, error: retryErr.message },
      );
    }
  }
}

// Export for testing
export { mergeLaneBranch };
