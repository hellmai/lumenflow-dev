// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Micro-Worktree Operations
 *
 * Race-safe micro-worktree isolation pattern extracted from wu-create.ts (WU-1262).
 * Provides shared infrastructure for commands that need to modify main branch
 * atomically without switching checkout.
 *
 * Part of WU-1262: Race-safe WU creation using micro-worktrees
 * Extended in WU-1274: Add wu:edit command for spec-only changes
 * Extended in WU-1439: Migrate initiative:create and wu:create to shared helper
 *
 * Pattern:
 * 1. Create temp branch without switching main checkout
 * 2. Create micro-worktree in /tmp pointing to temp branch
 * 3. Perform operations in micro-worktree
 * 4. FF-only merge temp branch to main (retry with rebase if main moved)
 * 5. Push to origin
 * 6. Cleanup (always, even on failure)
 *
 * Benefits:
 * - Main checkout never switches branches (no impact on other agents)
 * - Race conditions handled via rebase+retry (up to MAX_MERGE_RETRIES attempts)
 * - Cleanup guaranteed even on failure
 *
 * Consumers:
 * @see {@link packages/@lumenflow/cli/src/wu-create.ts} - WU creation (WU-1262, WU-1439)
 * @see {@link packages/@lumenflow/cli/src/wu-edit.ts} - Spec edits (WU-1274)
 * @see {@link packages/@lumenflow/cli/src/initiative-create.ts} - Initiative creation (WU-1439)
 */

import { getGitForCwd, createGitForPath } from './git-adapter.js';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import pRetry from 'p-retry';
import {
  BRANCHES,
  REMOTES,
  GIT_REFS,
  PKG_MANAGER,
  SCRIPTS,
  PRETTIER_FLAGS,
  STDIO_MODES,
} from './wu-constants.js';
import { getConfig } from './lumenflow-config.js';
import {
  MAX_MERGE_RETRIES,
  MAX_PUSH_RETRIES,
  DEFAULT_PUSH_RETRY_CONFIG,
  resolvePushRetryConfig,
  LUMENFLOW_FORCE_ENV,
  LUMENFLOW_FORCE_REASON_ENV,
  LUMENFLOW_WU_TOOL_ENV,
  DEFAULT_LOG_PREFIX,
  RetryExhaustionError,
  isRetryExhaustionError,
  formatRetryExhaustionError,
  shouldSkipRemoteOperations,
  runMicroWorktreeSyncPreamble,
  getTempBranchName,
  createMicroWorktreeDir,
  findWorktreeByBranch,
  cleanupOrphanedMicroWorktree,
  cleanupMicroWorktree,
  pushRefspecWithForce,
  pushRefspecWithRetry,
} from './micro-worktree-shared.js';
import type { GitAdapter } from './git-adapter.js';
import type { PushRetryConfig } from './lumenflow-config-schema.js';
import type { FormatRetryExhaustionOptions } from './micro-worktree-shared.js';
import { createError, ErrorCodes } from './error-handler.js';

/**
 * Context passed to the execute function in withMicroWorktree
 */
interface MicroWorktreeContext {
  /** Path to the micro-worktree directory */
  worktreePath: string;
  /** GitAdapter instance for the micro-worktree */
  gitWorktree: GitAdapter;
}

/**
 * Result returned by the execute function in withMicroWorktree
 */
interface MicroWorktreeExecuteResult {
  /** Commit message for the changes */
  commitMessage: string;
  /** List of files that were modified */
  files: string[];
}

/**
 * Options for withMicroWorktree
 */
interface WithMicroWorktreeOptions {
  /** Operation name (e.g., 'wu-create', 'wu-edit') */
  operation: string;
  /** WU ID (e.g., 'WU-123') */
  id: string;
  /** Log prefix for console output */
  logPrefix?: string;
  /** Skip local main merge, push directly to origin/main */
  pushOnly?: boolean;
  /**
   * Optional operation-specific push retry overrides (pushOnly mode).
   * Values override global `git.push_retry` from config.
   */
  pushRetryOverride?: Partial<PushRetryConfig>;
  /** Async function to execute in micro-worktree */
  execute: (context: MicroWorktreeContext) => Promise<MicroWorktreeExecuteResult>;
}

/**
 * Result from withMicroWorktree
 */
interface WithMicroWorktreeResult extends MicroWorktreeExecuteResult {
  /** Git ref to use for worktree creation */
  ref: string;
}

/**
 * Maximum retry attempts for ff-only merge when main moves
 *
 * This handles race conditions when multiple agents run wu:create or wu:edit
 * concurrently. Each retry fetches latest main and rebases.
 */
export {
  MAX_MERGE_RETRIES,
  MAX_PUSH_RETRIES,
  DEFAULT_PUSH_RETRY_CONFIG,
  resolvePushRetryConfig,
  LUMENFLOW_FORCE_ENV,
  LUMENFLOW_FORCE_REASON_ENV,
  LUMENFLOW_WU_TOOL_ENV,
  DEFAULT_LOG_PREFIX,
  RetryExhaustionError,
  isRetryExhaustionError,
  formatRetryExhaustionError,
  shouldSkipRemoteOperations,
  getTempBranchName,
  createMicroWorktreeDir,
  findWorktreeByBranch,
  cleanupOrphanedMicroWorktree,
  cleanupMicroWorktree,
  pushRefspecWithForce,
  pushRefspecWithRetry,
};
export type { FormatRetryExhaustionOptions };

export async function stageChangesWithDeletions(
  gitWorktree: GitAdapter,
  files: string[] | undefined,
): Promise<void> {
  // Normalise undefined/null to empty array for addWithDeletions
  const filesToStage = files || [];
  await gitWorktree.addWithDeletions(filesToStage);
}

/**
 * WU-1365: Check if prettier is available in the project
 *
 * Checks if prettier is installed and executable. Returns false if:
 * - prettier is not in node_modules
 * - pnpm prettier command is not available
 *
 * This allows micro-worktree operations to skip formatting gracefully
 * when prettier is not installed (e.g., in bootstrap or minimal setups).
 *
 * @returns {boolean} True if prettier is available, false otherwise
 */
export function isPrettierAvailable(cwd?: string): boolean {
  try {
    // Check if prettier is available via pnpm prettier --version
    // No user input in this command - known-safe constant strings only.
    // WU-1755: Accept optional cwd so prettier resolves from project root,
    // not from /tmp/ micro-worktrees which have no node_modules.
    const opts: Record<string, unknown> = {
      encoding: 'utf-8',
      stdio: STDIO_MODES.PIPE,
    };
    if (cwd) {
      opts.cwd = cwd;
    }

    execSync(`${PKG_MANAGER} ${SCRIPTS.PRETTIER} --version`, opts);
    return true;
  } catch {
    return false;
  }
}

/**
 * WU-1365: Pattern to detect prettier not found errors
 */
const PRETTIER_NOT_FOUND_PATTERNS = [
  /ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL/,
  /prettier.*not found/i,
  /Cannot find module.*prettier/i,
  /Command failed.*prettier/i,
  /No script.*prettier/i,
];

/**
 * WU-1365: Check if an error indicates prettier is not available
 *
 * @param {string} errMsg - Error message to check
 * @returns {boolean} True if the error indicates prettier is not installed/available
 */
function isPrettierNotFoundError(errMsg: string): boolean {
  return PRETTIER_NOT_FOUND_PATTERNS.some((pattern) => pattern.test(errMsg));
}

/**
 * Format files using prettier before committing
 *
 * WU-1435: Ensures committed files pass format gates.
 * WU-1365: Gracefully handles missing prettier installation.
 * Runs prettier --write on specified files within the micro-worktree.
 *
 * @param {string[]} files - Relative file paths to format
 * @param {string} worktreePath - Path to the micro-worktree
 * @param {string} logPrefix - Log prefix for console output
 */
export async function formatFiles(
  files: string[] | undefined,
  worktreePath: string,
  logPrefix: string = DEFAULT_LOG_PREFIX,
): Promise<void> {
  if (!files || files.length === 0) {
    return;
  }

  console.log(`${logPrefix} Formatting ${files.length} file(s)...`);

  // Build absolute paths within the worktree
  const absolutePaths = files.map((f) => join(worktreePath, f));
  const pathArgs = absolutePaths.map((p) => JSON.stringify(p)).join(' ');

  try {
    // Note: This uses execSync with validated paths (built from worktreePath and file list)

    execSync(`${PKG_MANAGER} ${SCRIPTS.PRETTIER} ${PRETTIER_FLAGS.WRITE} ${pathArgs}`, {
      encoding: 'utf-8',
      stdio: STDIO_MODES.PIPE,
      cwd: worktreePath,
    });
    console.log(`${logPrefix} ✅ Files formatted`);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);

    // WU-1365: Check if the error is due to prettier not being available
    if (isPrettierNotFoundError(errMsg)) {
      console.warn(
        `${logPrefix} ⚠️  Skipping formatting: prettier not available.\n` +
          `    To enable formatting, install prettier: pnpm add -D prettier\n` +
          `    Files will be committed without formatting.`,
      );
      return;
    }

    // Log warning but don't fail - some files may not need formatting
    console.warn(`${logPrefix} ⚠️  Formatting warning: ${errMsg}`);
  }
}

/**
 * Merge temp branch to main with ff-only and retry logic
 *
 * Handles race conditions when main branch advances between operation start
 * and merge attempt. Retries with rebase up to MAX_MERGE_RETRIES times.
 *
 * @param {string} tempBranchName - Temp branch to merge
 * @param {string} microWorktreePath - Path to micro-worktree (for rebase)
 * @param {string} logPrefix - Log prefix for console output
 * @throws {Error} If merge fails after all retries
 */
export async function mergeWithRetry(
  tempBranchName: string,
  microWorktreePath: string,
  logPrefix: string = DEFAULT_LOG_PREFIX,
): Promise<void> {
  const gitWorktree = createGitForPath(microWorktreePath);
  const mainGit = getGitForCwd();

  for (let attempt = 1; attempt <= MAX_MERGE_RETRIES; attempt++) {
    try {
      console.log(`${logPrefix} Merging to main (attempt ${attempt}/${MAX_MERGE_RETRIES})...`);
      await mainGit.merge(tempBranchName, { ffOnly: true });
      console.log(`${logPrefix} ✅ Merged to main`);
      return;
    } catch (mergeErr: unknown) {
      if (attempt < MAX_MERGE_RETRIES) {
        console.log(`${logPrefix} ⚠️  FF-only merge failed (main moved). Rebasing...`);
        // Fetch latest main and rebase temp branch
        await mainGit.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
        await mainGit.merge(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`, { ffOnly: true }); // Update local main
        await gitWorktree.rebase(BRANCHES.MAIN);
      } else {
        const errMsg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        throw createError(
          ErrorCodes.MERGE_EXHAUSTION,
          `FF-only merge failed after ${MAX_MERGE_RETRIES} attempts. ` +
            `Main branch may have significant divergence.\n` +
            `Error: ${errMsg}`,
        );
      }
    }
  }
}

/**
 * Push to origin/main with retry logic for race conditions
 *
 * WU-1179: When push fails because origin/main advanced (race condition with
 * parallel agents), this function retries with fetch and rebase.
 *
 * WU-1348: The retry logic no longer resets the main checkout. Instead, it:
 * 1. Fetches origin/main to get latest remote state
 * 2. Rebases the temp branch onto origin/main (in the micro-worktree)
 * 3. Re-merges the rebased temp branch to local main (ff-only)
 * 4. Retries the push
 *
 * This preserves micro-worktree isolation - the main checkout files are never
 * hard-reset, preventing file flash and preserving UnsafeAny uncommitted work.
 *
 * @param {Object} mainGit - GitAdapter instance for main checkout
 * @param {Object} worktreeGit - GitAdapter instance for micro-worktree
 * @param {string} remote - Remote name (e.g., 'origin')
 * @param {string} branch - Branch name (e.g., 'main')
 * @param {string} tempBranchName - Temp branch that was merged (for rebase)
 * @param {string} logPrefix - Log prefix for console output
 * @throws {Error} If push fails after all retries
 */
export async function pushWithRetry(
  mainGit: GitAdapter,
  worktreeGit: GitAdapter,
  remote: string,
  branch: string,
  tempBranchName: string,
  logPrefix: string = DEFAULT_LOG_PREFIX,
  operation?: string,
): Promise<void> {
  const maxRetries = MAX_PUSH_RETRIES;

  // WU-1418: Save original LUMENFLOW_WU_TOOL value
  const originalWuTool = process.env[LUMENFLOW_WU_TOOL_ENV];

  try {
    // WU-1418: Set LUMENFLOW_WU_TOOL to allow pre-push hook to recognize this as an automated operation
    if (operation) {
      process.env[LUMENFLOW_WU_TOOL_ENV] = operation;
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `${logPrefix} Pushing to ${remote}/${branch} (attempt ${attempt}/${maxRetries})...`,
        );
        await mainGit.push(remote, branch);
        console.log(`${logPrefix} ✅ Pushed to ${remote}/${branch}`);
        return;
      } catch (pushErr: unknown) {
        if (attempt < maxRetries) {
          console.log(
            `${logPrefix} ⚠️  Push failed (origin moved). Fetching and rebasing before retry...`,
          );

          // WU-1348: Do NOT reset main checkout - preserve micro-worktree isolation
          // Instead, fetch latest remote state and rebase the temp branch

          // Step 1: Fetch latest origin/main
          console.log(`${logPrefix} Fetching ${remote}/${branch}...`);
          await mainGit.fetch(remote, branch);

          // Step 2: Rebase temp branch onto updated origin/main
          console.log(`${logPrefix} Rebasing temp branch onto ${remote}/${branch}...`);
          await worktreeGit.rebase(`${remote}/${branch}`);

          // Step 3: Re-merge temp branch to local main (ff-only)
          // This updates local main to include the rebased commits
          console.log(`${logPrefix} Re-merging temp branch to ${branch}...`);
          await mainGit.merge(tempBranchName, { ffOnly: true });
        } else {
          const errMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
          throw createError(
            ErrorCodes.RETRY_EXHAUSTION,
            `Push failed after ${maxRetries} attempts. ` +
              `Origin ${branch} may have significant traffic.\n\n` +
              `Suggestions:\n` +
              `  - Wait a few seconds and retry the operation\n` +
              `  - Check if another agent is rapidly pushing changes\n` +
              `Error: ${errMsg}`,
          );
        }
      }
    }
  } finally {
    // WU-1418: Restore original LUMENFLOW_WU_TOOL value
    if (originalWuTool === undefined) {
      Reflect.deleteProperty(process.env, LUMENFLOW_WU_TOOL_ENV);
    } else {
      process.env[LUMENFLOW_WU_TOOL_ENV] = originalWuTool;
    }
  }
}

/**
 * WU-1332: Push to origin with configurable retry using p-retry
 *
 * Enhanced version of pushWithRetry that uses p-retry for exponential backoff
 * and supports configuration via PushRetryConfig. When push fails due to
 * non-fast-forward (origin moved), automatically rebases and retries.
 *
 * WU-1348: The retry logic no longer resets the main checkout. Instead, it:
 * 1. Fetches origin/main to get latest remote state
 * 2. Rebases the temp branch onto origin/main (in the micro-worktree)
 * 3. Re-merges the rebased temp branch to local main (ff-only)
 * 4. Retries the push
 *
 * This preserves micro-worktree isolation - the main checkout files are never
 * hard-reset, preventing file flash and preserving UnsafeAny uncommitted work.
 *
 * @param {Object} mainGit - GitAdapter instance for main checkout
 * @param {Object} worktreeGit - GitAdapter instance for micro-worktree
 * @param {string} remote - Remote name (e.g., 'origin')
 * @param {string} branch - Branch name (e.g., 'main')
 * @param {string} tempBranchName - Temp branch that was merged (for rebase)
 * @param {string} logPrefix - Log prefix for console output
 * @param {PushRetryConfig} config - Push retry configuration
 * @throws {Error} If push fails after all retries or if retry is disabled
 */
export async function pushWithRetryConfig(
  mainGit: GitAdapter,
  worktreeGit: GitAdapter,
  remote: string,
  branch: string,
  tempBranchName: string,
  logPrefix: string = DEFAULT_LOG_PREFIX,
  config: PushRetryConfig = DEFAULT_PUSH_RETRY_CONFIG,
  operation?: string,
): Promise<void> {
  // WU-1418: Save original LUMENFLOW_WU_TOOL value
  const originalWuTool = process.env[LUMENFLOW_WU_TOOL_ENV];

  try {
    // WU-1418: Set LUMENFLOW_WU_TOOL to allow pre-push hook to recognize this as an automated operation
    if (operation) {
      process.env[LUMENFLOW_WU_TOOL_ENV] = operation;
    }

    // If retry is disabled, just try once and throw on failure
    if (!config.enabled) {
      console.log(`${logPrefix} Pushing to ${remote}/${branch} (retry disabled)...`);
      await mainGit.push(remote, branch);
      console.log(`${logPrefix} ✅ Pushed to ${remote}/${branch}`);
      return;
    }

    let attemptNumber = 0;

    await pRetry(
      async () => {
        attemptNumber++;
        console.log(
          `${logPrefix} Pushing to ${remote}/${branch} (attempt ${attemptNumber}/${config.retries})...`,
        );

        try {
          await mainGit.push(remote, branch);
          console.log(`${logPrefix} ✅ Pushed to ${remote}/${branch}`);
        } catch (pushErr: unknown) {
          console.log(
            `${logPrefix} ⚠️  Push failed (origin moved). Fetching and rebasing before retry...`,
          );

          // WU-1348: Do NOT reset main checkout - preserve micro-worktree isolation
          // Instead, fetch latest remote state and rebase the temp branch

          // Fetch latest origin/main
          console.log(`${logPrefix} Fetching ${remote}/${branch}...`);
          await mainGit.fetch(remote, branch);

          // Rebase temp branch onto updated origin/main
          console.log(`${logPrefix} Rebasing temp branch onto ${remote}/${branch}...`);
          await worktreeGit.rebase(`${remote}/${branch}`);

          // Re-merge temp branch to local main (ff-only)
          // This updates local main to include the rebased commits
          console.log(`${logPrefix} Re-merging temp branch to ${branch}...`);
          await mainGit.merge(tempBranchName, { ffOnly: true });

          // Re-throw to trigger p-retry
          throw pushErr;
        }
      },
      {
        retries: config.retries - 1, // p-retry counts retries after first attempt
        minTimeout: config.min_delay_ms,
        maxTimeout: config.max_delay_ms,
        randomize: config.jitter,
        onFailedAttempt: () => {
          // Logging is handled in the try/catch above
        },
      },
    ).catch(() => {
      // p-retry exhausted all retries, throw descriptive error
      throw createError(
        ErrorCodes.RETRY_EXHAUSTION,
        `Push failed after ${config.retries} attempts. ` +
          `Origin ${branch} may have significant traffic.\n\n` +
          `Suggestions:\n` +
          `  - Wait a few seconds and retry the operation\n` +
          `  - Increase git.push_retry.retries in workspace.yaml software_delivery\n` +
          `  - Check if another agent is rapidly pushing changes`,
      );
    });
  } finally {
    // WU-1418: Restore original LUMENFLOW_WU_TOOL value
    if (originalWuTool === undefined) {
      Reflect.deleteProperty(process.env, LUMENFLOW_WU_TOOL_ENV);
    } else {
      process.env[LUMENFLOW_WU_TOOL_ENV] = originalWuTool;
    }
  }
}

/**
 * Push using refspec with LUMENFLOW_FORCE to bypass pre-push hooks
 *
 * WU-1081: Micro-worktree pushes to origin/main need to bypass pre-push hooks
 * because they operate from temp branches in /tmp directories, which would
 * otherwise be blocked by hook validation.
 *
 * Sets LUMENFLOW_FORCE=1 and LUMENFLOW_FORCE_REASON during the push,
 * then restores original environment values (even on error).
 *
 * @param {GitAdapter} gitAdapter - GitAdapter instance to use for push
 * @param {string} remote - Remote name (e.g., 'origin')
 * @param {string} localRef - Local ref to push (e.g., 'tmp/wu-claim/wu-123')
 * @param {string} remoteRef - Remote ref to update (e.g., 'main')
 * @param {string} reason - Audit reason for the LUMENFLOW_FORCE bypass
 * @returns {Promise<void>}
 * @throws {Error} If push fails (env vars still restored)
 */
export async function withMicroWorktree(
  options: WithMicroWorktreeOptions,
): Promise<WithMicroWorktreeResult> {
  const {
    operation,
    id,
    logPrefix = `[${operation}]`,
    execute,
    pushOnly = false,
    pushRetryOverride,
  } = options;

  const mainGit = getGitForCwd();

  // WU-1308: Check if remote operations should be skipped (local-only mode)
  const skipRemote = shouldSkipRemoteOperations();

  // WU-2237: Clean up UnsafeAny orphaned temp branch/worktree from previous interrupted operations
  // This makes the operation idempotent - a retry after crash/timeout will succeed
  await cleanupOrphanedMicroWorktree(operation, id, mainGit, logPrefix);

  const tempBranchName = getTempBranchName(operation, id);
  const { baseRef } = await runMicroWorktreeSyncPreamble({
    mainGit,
    logPrefix,
    pushOnly,
    skipRemote,
  });
  const microWorktreePath = createMicroWorktreeDir(`${operation}-`);

  console.log(`${logPrefix} Using micro-worktree isolation (WU-1262)`);
  console.log(`${logPrefix} Temp branch: ${tempBranchName}`);
  console.log(`${logPrefix} Micro-worktree: ${microWorktreePath}`);
  if (pushOnly) {
    console.log(`${logPrefix} Push-only mode: local main will not be modified (WU-1435/WU-1672)`);
  }

  try {
    // Step 1: Create temp branch without switching
    console.log(`${logPrefix} Creating temp branch...`);
    await mainGit.createBranchNoCheckout(tempBranchName, baseRef);

    // Step 2: Create micro-worktree pointing to temp branch
    console.log(`${logPrefix} Creating micro-worktree...`);
    await mainGit.worktreeAddExisting(microWorktreePath, tempBranchName);

    // Step 3: Execute the operation in micro-worktree
    const gitWorktree = createGitForPath(microWorktreePath);
    const result = await execute({ worktreePath: microWorktreePath, gitWorktree });

    // Step 4: Format files before committing (WU-1435)
    await formatFiles(result.files, microWorktreePath, logPrefix);

    // Step 5: Stage and commit in micro-worktree
    // WU-1813: Use stageChangesWithDeletions to properly handle file deletions
    console.log(`${logPrefix} Staging changes (including deletions)...`);
    await stageChangesWithDeletions(gitWorktree, result.files);
    console.log(`${logPrefix} Committing in micro-worktree...`);
    await gitWorktree.commit(result.commitMessage);
    console.log(`${logPrefix} ✅ Committed: ${result.commitMessage}`);

    // Step 6: Push to origin (different paths for pushOnly vs standard)
    // WU-1308: Skip push when git.requireRemote=false (local-only mode)
    if (skipRemote) {
      // Local-only mode: merge to local main but skip push
      console.log(`${logPrefix} Local-only mode: merging to local main (skipping push)`);
      await mainGit.merge(tempBranchName, { ffOnly: true });
      console.log(`${logPrefix} ✅ Merged to local main (no remote push)`);
      return { ...result, ref: BRANCHES.MAIN };
    } else if (pushOnly) {
      // WU-1435: Push directly to origin/main without touching local main
      // WU-1081: Use LUMENFLOW_FORCE to bypass pre-push hooks for micro-worktree pushes
      // WU-1337: Use pushRefspecWithRetry to handle race conditions with rebase

      // Resolve effective push_retry config from defaults + global + operation override
      const config = getConfig();
      const pushRetryConfig = resolvePushRetryConfig(config.git.push_retry, pushRetryOverride);

      await pushRefspecWithRetry(
        gitWorktree,
        mainGit,
        REMOTES.ORIGIN,
        tempBranchName,
        BRANCHES.MAIN,
        `micro-worktree push for ${operation} (automated)`,
        logPrefix,
        pushRetryConfig,
      );

      // Fetch to update remote tracking ref (FETCH_HEAD)
      console.log(`${logPrefix} Fetching ${REMOTES.ORIGIN}/${BRANCHES.MAIN}...`);
      await mainGit.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
      console.log(`${logPrefix} ✅ Fetched ${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);

      // Return FETCH_HEAD as ref for worktree creation
      return { ...result, ref: GIT_REFS.FETCH_HEAD };
    } else {
      // Standard path: merge to local main, then push
      const gitWorktree = createGitForPath(microWorktreePath);
      await mergeWithRetry(tempBranchName, microWorktreePath, logPrefix);

      // WU-1179: Use pushWithRetry to handle race conditions
      // On push failure, rollback local main and retry with rebase
      // WU-1418: Pass operation name to set LUMENFLOW_WU_TOOL for pre-push hook bypass
      await pushWithRetry(
        mainGit,
        gitWorktree,
        REMOTES.ORIGIN,
        BRANCHES.MAIN,
        tempBranchName,
        logPrefix,
        operation,
      );

      return { ...result, ref: BRANCHES.MAIN };
    }
  } finally {
    // Cleanup (always runs)
    await cleanupMicroWorktree(microWorktreePath, tempBranchName, logPrefix);
  }
}
