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
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
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
import type { GitAdapter } from './git-adapter.js';
import type { PushRetryConfig } from './lumenflow-config-schema.js';

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
export const MAX_MERGE_RETRIES = 3;

/**
 * Maximum retry attempts for push when origin/main advances
 *
 * WU-1179: When push fails due to race condition (origin advanced while we
 * were working), rollback local main to origin/main and retry.
 * Each retry: fetch -> rebase temp branch -> re-merge -> push.
 *
 * @deprecated Use DEFAULT_PUSH_RETRY_CONFIG.retries instead (WU-1332)
 */
export const MAX_PUSH_RETRIES = 3;

/**
 * WU-1332: Default push retry configuration
 *
 * Provides sensible defaults for micro-worktree push operations.
 * Can be overridden via .lumenflow.config.yaml git.push_retry section.
 */
export const DEFAULT_PUSH_RETRY_CONFIG: PushRetryConfig = {
  enabled: true,
  retries: 3,
  min_delay_ms: 100,
  max_delay_ms: 1000,
  jitter: true,
};

/**
 * Environment variable name for LUMENFLOW_FORCE bypass
 *
 * WU-1081: Exported for use in micro-worktree push operations.
 */
export const LUMENFLOW_FORCE_ENV = 'LUMENFLOW_FORCE';

/**
 * Environment variable name for LUMENFLOW_FORCE_REASON audit trail
 *
 * WU-1081: Exported for use in micro-worktree push operations.
 */
export const LUMENFLOW_FORCE_REASON_ENV = 'LUMENFLOW_FORCE_REASON';

/**
 * Default log prefix for micro-worktree operations
 *
 * Extracted to constant to satisfy sonarjs/no-duplicate-string rule.
 */
export const DEFAULT_LOG_PREFIX = '[micro-wt]';

/**
 * WU-1336: Pattern to detect retry exhaustion errors from error messages
 *
 * Matches error messages like "Push failed after N attempts"
 * Used for backwards compatibility with legacy error messages.
 */
const RETRY_EXHAUSTION_PATTERN = /Push failed after \d+ attempts/;

/**
 * WU-1336: Typed error for retry exhaustion in micro-worktree operations
 *
 * Thrown when push retries are exhausted due to race conditions with parallel agents.
 * CLI commands should use `isRetryExhaustionError` to detect this error type and
 * `formatRetryExhaustionError` to generate actionable user-facing messages.
 *
 * This centralizes retry exhaustion handling so CLI commands do not need to
 * duplicate detection logic or error formatting.
 *
 * @example
 * ```typescript
 * import { RetryExhaustionError, isRetryExhaustionError, formatRetryExhaustionError } from '@lumenflow/core';
 *
 * try {
 *   await withMicroWorktree({ ... });
 * } catch (error) {
 *   if (isRetryExhaustionError(error)) {
 *     console.error(formatRetryExhaustionError(error, { command: 'pnpm initiative:add-wu ...' }));
 *   } else {
 *     throw error;
 *   }
 * }
 * ```
 */
export class RetryExhaustionError extends Error {
  /** Name of the error class (for instanceof checks across module boundaries) */
  readonly name = 'RetryExhaustionError';

  /** Operation that was being performed (e.g., 'initiative-add-wu') */
  readonly operation: string;

  /** Number of retry attempts that were exhausted */
  readonly retries: number;

  constructor(operation: string, retries: number) {
    super(
      `Push failed after ${retries} attempts. ` +
        `Origin main may have significant traffic during ${operation}.`,
    );
    this.operation = operation;
    this.retries = retries;

    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, RetryExhaustionError.prototype);
  }
}

/**
 * WU-1336: Options for formatting retry exhaustion error messages
 */
export interface FormatRetryExhaustionOptions {
  /** Command to suggest for retrying (e.g., 'pnpm initiative:add-wu --wu WU-123 --initiative INIT-001') */
  command: string;
}

/**
 * WU-1336: Type guard to check if an error is a retry exhaustion error
 *
 * Detects both the typed `RetryExhaustionError` class and legacy error messages
 * that match the "Push failed after N attempts" pattern.
 *
 * @param {unknown} error - Error to check
 * @returns {boolean} True if this is a retry exhaustion error
 *
 * @example
 * ```typescript
 * if (isRetryExhaustionError(error)) {
 *   // Handle retry exhaustion
 * }
 * ```
 */
export function isRetryExhaustionError(error: unknown): error is Error {
  if (error instanceof RetryExhaustionError) {
    return true;
  }

  // Also detect legacy error messages for backwards compatibility
  if (error instanceof Error) {
    return RETRY_EXHAUSTION_PATTERN.test(error.message);
  }

  return false;
}

/**
 * WU-1336: Format retry exhaustion error with actionable next steps
 *
 * When push retries are exhausted, provides clear guidance on how to proceed.
 * CLI commands should use this instead of duplicating error formatting logic.
 *
 * @param {Error} error - The retry exhaustion error
 * @param {FormatRetryExhaustionOptions} options - Formatting options
 * @returns {string} Formatted error message with next steps
 *
 * @example
 * ```typescript
 * const message = formatRetryExhaustionError(error, {
 *   command: 'pnpm initiative:add-wu --wu WU-123 --initiative INIT-001',
 * });
 * console.error(message);
 * ```
 */
export function formatRetryExhaustionError(
  error: Error,
  options: FormatRetryExhaustionOptions,
): string {
  const { command } = options;

  return (
    `${error.message}\n\n` +
    `Next steps:\n` +
    `  1. Wait a few seconds and retry the operation:\n` +
    `     ${command}\n` +
    `  2. If the issue persists, check if another agent is rapidly pushing changes\n` +
    `  3. Consider increasing git.push_retry.retries in .lumenflow.config.yaml`
  );
}

/**
 * WU-1308: Check if remote operations should be skipped based on git.requireRemote config
 *
 * When git.requireRemote is false, micro-worktree operations skip:
 * - Fetching origin/main before starting
 * - Pushing to origin/main after completion
 *
 * This enables local-only development without a remote repository.
 *
 * @returns {boolean} True if remote operations should be skipped (requireRemote=false)
 *
 * @example
 * ```yaml
 * # .lumenflow.config.yaml
 * git:
 *   requireRemote: false  # Enable local-only mode
 * ```
 */
export function shouldSkipRemoteOperations(): boolean {
  const config = getConfig();
  // Default is requireRemote=true, so only skip if explicitly set to false
  return config.git.requireRemote === false;
}

/**
 * Temp branch prefix for micro-worktree operations
 *
 * @param {string} operation - Operation name (e.g., 'wu-create', 'wu-edit')
 * @param {string} id - WU ID (e.g., 'wu-123')
 * @returns {string} Temp branch name (e.g., 'tmp/wu-create/wu-123')
 */
export function getTempBranchName(operation: string, id: string): string {
  return `${BRANCHES.TEMP_PREFIX}${operation}/${id.toLowerCase()}`;
}

/**
 * Create micro-worktree in /tmp directory
 *
 * @param {string} prefix - Directory prefix (e.g., 'wu-create-', 'wu-edit-')
 * @returns {string} Path to created micro-worktree directory
 */
export function createMicroWorktreeDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Parse git worktree list output to find worktrees by branch
 *
 * WU-2237: Helper to parse porcelain format output from `git worktree list --porcelain`
 *
 * @param {string} worktreeListOutput - Output from git worktree list --porcelain
 * @param {string} branchName - Branch name to search for (e.g., 'tmp/wu-create/wu-123')
 * @returns {string|null} Worktree path if found, null otherwise
 */
export function findWorktreeByBranch(
  worktreeListOutput: string,
  branchName: string,
): string | null {
  const branchRef = `refs/heads/${branchName}`;
  const lines = worktreeListOutput.split('\n');

  let currentWorktreePath: string | null = null;

  for (const line of lines) {
    if (line.startsWith('worktree ')) {
      currentWorktreePath = line.substring('worktree '.length);
    } else if (line.startsWith('branch ') && line.substring('branch '.length) === branchRef) {
      return currentWorktreePath;
    } else if (line === '') {
      currentWorktreePath = null;
    }
  }

  return null;
}

/**
 * Clean up orphaned micro-worktree and temp branch from a previous interrupted operation
 *
 * WU-2237: Before creating a new micro-worktree, detect and clean any existing temp
 * branch/worktree for the same operation+WU ID. This handles scenarios where:
 * - A previous wu:create/wu:edit was interrupted (timeout/crash)
 * - The temp branch and /tmp worktree were left behind
 * - A subsequent operation would fail with 'branch already exists'
 *
 * This function is idempotent - safe to call even when no orphans exist.
 *
 * @param {string} operation - Operation name (e.g., 'wu-create', 'wu-edit')
 * @param {string} id - WU ID (e.g., 'WU-123')
 * @param {Object} gitAdapter - GitAdapter instance to use (for testability)
 * @param {string} logPrefix - Log prefix for console output
 * @returns {Promise<{cleanedWorktree: boolean, cleanedBranch: boolean}>} Cleanup status
 */
export async function cleanupOrphanedMicroWorktree(
  operation: string,
  id: string,
  gitAdapter: GitAdapter,
  logPrefix: string = DEFAULT_LOG_PREFIX,
): Promise<{ cleanedWorktree: boolean; cleanedBranch: boolean }> {
  const tempBranchName = getTempBranchName(operation, id);
  let cleanedWorktree = false;
  let cleanedBranch = false;

  // Step 1: Check git worktree list for any worktree on this temp branch
  try {
    const worktreeListOutput = await gitAdapter.worktreeList();
    const orphanWorktreePath = findWorktreeByBranch(worktreeListOutput, tempBranchName);

    if (orphanWorktreePath) {
      console.log(
        `${logPrefix} Found orphaned worktree for ${tempBranchName}: ${orphanWorktreePath}`,
      );
      try {
        await gitAdapter.worktreeRemove(orphanWorktreePath, { force: true });
        console.log(`${logPrefix} ✅ Removed orphaned worktree: ${orphanWorktreePath}`);
        cleanedWorktree = true;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.warn(`${logPrefix} ⚠️  Could not remove orphaned worktree: ${errMsg}`);
        // Try filesystem cleanup as fallback
        tryFilesystemCleanup(orphanWorktreePath);
        cleanedWorktree = true;
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} ⚠️  Could not check worktree list: ${errMsg}`);
  }

  // Step 2: Check if the temp branch exists and delete it
  try {
    const branchExists = await gitAdapter.branchExists(tempBranchName);
    if (branchExists) {
      console.log(`${logPrefix} Found orphaned temp branch: ${tempBranchName}`);
      await gitAdapter.deleteBranch(tempBranchName, { force: true });
      console.log(`${logPrefix} ✅ Deleted orphaned temp branch: ${tempBranchName}`);
      cleanedBranch = true;
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} ⚠️  Could not delete orphaned branch: ${errMsg}`);
  }

  return { cleanedWorktree, cleanedBranch };
}

/**
 * Try to remove a worktree path via filesystem as fallback
 *
 * WU-2237: Extracted helper to reduce cognitive complexity.
 *
 * @param {string} worktreePath - Path to remove
 */
function tryFilesystemCleanup(worktreePath: string): void {
  try {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool with validated worktree path
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  } catch {
    // Ignore filesystem cleanup errors
  }
}

/**
 * Remove a worktree using git, with filesystem fallback
 *
 * WU-2237: Extracted helper to reduce cognitive complexity.
 *
 * @param {Object} gitAdapter - Git adapter instance
 * @param {string} worktreePath - Path to worktree
 * @param {string} logPrefix - Log prefix
 * @param {string} [contextLabel] - Optional label for logging (e.g., 'registered')
 */
async function removeWorktreeSafe(
  gitAdapter: GitAdapter,
  worktreePath: string,
  logPrefix: string,
  contextLabel: string = '',
): Promise<void> {
  const label = contextLabel ? ` ${contextLabel}` : '';
  try {
    await gitAdapter.worktreeRemove(worktreePath, { force: true });
    if (contextLabel) {
      console.log(`${logPrefix} ✅ Removed${label} worktree: ${worktreePath}`);
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} ⚠️  Could not remove${label} worktree: ${errMsg}`);
    tryFilesystemCleanup(worktreePath);
  }
}

/**
 * Cleanup micro-worktree and temp branch
 *
 * Runs even on failure to prevent orphaned resources.
 * Safe to call multiple times (idempotent).
 *
 * WU-2237: Enhanced to also check git worktree list for registered worktrees
 * on the temp branch, in case the worktree path differs from what was expected.
 *
 * @param {string} worktreePath - Path to micro-worktree
 * @param {string} branchName - Temp branch name
 * @param {string} logPrefix - Log prefix for console output
 */
export async function cleanupMicroWorktree(
  worktreePath: string,
  branchName: string,
  logPrefix: string = DEFAULT_LOG_PREFIX,
): Promise<void> {
  console.log(`${logPrefix} Cleaning up micro-worktree...`);
  const mainGit = getGitForCwd();

  // Remove the known worktree path first (must be done before deleting branch)
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- CLI tool with validated worktree path
  if (existsSync(worktreePath)) {
    await removeWorktreeSafe(mainGit, worktreePath, logPrefix);
  }

  // WU-2237: Also check git worktree list for any registered worktrees on this branch
  await cleanupRegisteredWorktreeForBranch(mainGit, branchName, worktreePath, logPrefix);

  // Delete temp branch
  await deleteBranchSafe(mainGit, branchName, logPrefix);

  console.log(`${logPrefix} ✅ Cleanup complete`);
}

/**
 * Clean up any registered worktree for a branch that differs from the expected path
 *
 * WU-2237: Extracted helper to reduce cognitive complexity.
 *
 * @param {Object} gitAdapter - Git adapter instance
 * @param {string} branchName - Branch name to search for
 * @param {string} expectedPath - Expected worktree path (skip if matches)
 * @param {string} logPrefix - Log prefix
 */
async function cleanupRegisteredWorktreeForBranch(
  gitAdapter: GitAdapter,
  branchName: string,
  expectedPath: string,
  logPrefix: string,
): Promise<void> {
  try {
    const worktreeListOutput = await gitAdapter.worktreeList();
    const registeredPath = findWorktreeByBranch(worktreeListOutput, branchName);

    if (registeredPath && registeredPath !== expectedPath) {
      console.log(`${logPrefix} Found additional registered worktree: ${registeredPath}`);
      await removeWorktreeSafe(gitAdapter, registeredPath, logPrefix, 'registered');
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} ⚠️  Could not check worktree list: ${errMsg}`);
  }
}

/**
 * Delete a branch safely, ignoring errors
 *
 * WU-2237: Extracted helper to reduce cognitive complexity.
 *
 * @param {Object} gitAdapter - Git adapter instance
 * @param {string} branchName - Branch to delete
 * @param {string} logPrefix - Log prefix
 */
async function deleteBranchSafe(
  gitAdapter: GitAdapter,
  branchName: string,
  logPrefix: string,
): Promise<void> {
  try {
    const branchExists = await gitAdapter.branchExists(branchName);
    if (branchExists) {
      await gitAdapter.deleteBranch(branchName, { force: true });
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} ⚠️  Could not delete branch: ${errMsg}`);
  }
}

/**
 * Stage changes including deletions in micro-worktree
 *
 * WU-1813: Uses addWithDeletions to properly stage tracked file deletions.
 * This replaces the previous pattern of using gitWorktree.add(files) which
 * could miss deletions when files were removed.
 *
 * @param {Object} gitWorktree - GitAdapter instance for the worktree
 * @param {string[]|undefined} files - Files to stage (undefined/empty = stage all)
 * @returns {Promise<void>}
 */
export async function stageChangesWithDeletions(
  gitWorktree: GitAdapter,
  files: string[] | undefined,
): Promise<void> {
  // Normalise undefined/null to empty array for addWithDeletions
  const filesToStage = files || [];
  await gitWorktree.addWithDeletions(filesToStage);
}

/**
 * Format files using prettier before committing
 *
 * WU-1435: Ensures committed files pass format gates.
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
    // eslint-disable-next-line sonarjs/os-command -- CLI tool executing known safe prettier command with validated paths
    execSync(`${PKG_MANAGER} ${SCRIPTS.PRETTIER} ${PRETTIER_FLAGS.WRITE} ${pathArgs}`, {
      encoding: 'utf-8',
      stdio: STDIO_MODES.PIPE,
      cwd: worktreePath,
    });
    console.log(`${logPrefix} ✅ Files formatted`);
  } catch (err: unknown) {
    // Log warning but don't fail - some files may not need formatting
    const errMsg = err instanceof Error ? err.message : String(err);
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
        throw new Error(
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
 * parallel agents), this function rolls back local main to origin/main and
 * retries the full sequence: fetch -> rebase temp branch -> re-merge -> push.
 *
 * This prevents the scenario where local main is left diverged from origin
 * after a push failure.
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
): Promise<void> {
  // eslint-disable-next-line sonarjs/deprecation -- Using deprecated constant for backwards compatibility
  const maxRetries = MAX_PUSH_RETRIES;
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
        console.log(`${logPrefix} ⚠️  Push failed (origin moved). Rolling back and retrying...`);

        // Step 1: Rollback local main to origin/main
        console.log(`${logPrefix} Rolling back local ${branch} to ${remote}/${branch}...`);
        await mainGit.reset(`${remote}/${branch}`, { hard: true });

        // Step 2: Fetch latest origin/main
        console.log(`${logPrefix} Fetching ${remote}/${branch}...`);
        await mainGit.fetch(remote, branch);

        // Step 3: Update local main to match origin/main (ff-only)
        console.log(`${logPrefix} Updating local ${branch}...`);
        await mainGit.merge(`${remote}/${branch}`, { ffOnly: true });

        // Step 4: Rebase temp branch onto updated main
        console.log(`${logPrefix} Rebasing temp branch onto ${branch}...`);
        await worktreeGit.rebase(branch);

        // Step 5: Re-merge temp branch to local main
        console.log(`${logPrefix} Re-merging temp branch to ${branch}...`);
        await mainGit.merge(tempBranchName, { ffOnly: true });
      } else {
        const errMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        throw new Error(
          `Push failed after ${maxRetries} attempts. ` +
            `Origin ${branch} may have significant traffic.\n` +
            `Error: ${errMsg}`,
        );
      }
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
): Promise<void> {
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
        console.log(`${logPrefix} ⚠️  Push failed (origin moved). Rolling back and retrying...`);

        // Rollback local main to origin/main
        console.log(`${logPrefix} Rolling back local ${branch} to ${remote}/${branch}...`);
        await mainGit.reset(`${remote}/${branch}`, { hard: true });

        // Fetch latest origin/main
        console.log(`${logPrefix} Fetching ${remote}/${branch}...`);
        await mainGit.fetch(remote, branch);

        // Update local main to match origin/main (ff-only)
        console.log(`${logPrefix} Updating local ${branch}...`);
        await mainGit.merge(`${remote}/${branch}`, { ffOnly: true });

        // Rebase temp branch onto updated main
        console.log(`${logPrefix} Rebasing temp branch onto ${branch}...`);
        await worktreeGit.rebase(branch);

        // Re-merge temp branch to local main
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
      onFailedAttempt: (error) => {
        // Log is handled in the try/catch above
        if (error.retriesLeft === 0) {
          // This will be the final failure
        }
      },
    },
  ).catch(() => {
    // p-retry exhausted all retries, throw descriptive error
    throw new Error(
      `Push failed after ${config.retries} attempts. ` +
        `Origin ${branch} may have significant traffic.\n\n` +
        `Suggestions:\n` +
        `  - Wait a few seconds and retry the operation\n` +
        `  - Increase git.push_retry.retries in .lumenflow.config.yaml\n` +
        `  - Check if another agent is rapidly pushing changes`,
    );
  });
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
export async function pushRefspecWithForce(
  gitAdapter: GitAdapter,
  remote: string,
  localRef: string,
  remoteRef: string,
  reason: string,
): Promise<void> {
  // Save original env values
  const originalForce = process.env[LUMENFLOW_FORCE_ENV];
  const originalReason = process.env[LUMENFLOW_FORCE_REASON_ENV];

  try {
    // Set LUMENFLOW_FORCE for the push
    process.env[LUMENFLOW_FORCE_ENV] = '1';
    process.env[LUMENFLOW_FORCE_REASON_ENV] = reason;

    // Perform the push
    await gitAdapter.pushRefspec(remote, localRef, remoteRef);
  } finally {
    // Restore original env values
    if (originalForce === undefined) {
      Reflect.deleteProperty(process.env, LUMENFLOW_FORCE_ENV);
    } else {
      process.env[LUMENFLOW_FORCE_ENV] = originalForce;
    }

    if (originalReason === undefined) {
      Reflect.deleteProperty(process.env, LUMENFLOW_FORCE_REASON_ENV);
    } else {
      process.env[LUMENFLOW_FORCE_REASON_ENV] = originalReason;
    }
  }
}

/**
 * WU-1337: Push using refspec with LUMENFLOW_FORCE and retry logic
 *
 * Enhanced version of pushRefspecWithForce that adds retry with rebase
 * on non-fast-forward errors. Uses p-retry for exponential backoff and
 * respects git.push_retry configuration.
 *
 * On each retry:
 * 1. Fetch origin/main to get latest state
 * 2. Rebase the temp branch onto the updated main
 * 3. Retry the push with LUMENFLOW_FORCE
 *
 * This is used by pushOnly mode in withMicroWorktree to handle race conditions
 * when multiple agents are pushing to origin/main concurrently.
 *
 * @param {GitAdapter} gitWorktree - GitAdapter instance for the worktree (for rebase)
 * @param {GitAdapter} mainGit - GitAdapter instance for main checkout (for fetch)
 * @param {string} remote - Remote name (e.g., 'origin')
 * @param {string} localRef - Local ref to push (e.g., 'tmp/wu-claim/wu-123')
 * @param {string} remoteRef - Remote ref to update (e.g., 'main')
 * @param {string} reason - Audit reason for the LUMENFLOW_FORCE bypass
 * @param {string} logPrefix - Log prefix for console output
 * @param {PushRetryConfig} config - Push retry configuration
 * @returns {Promise<void>}
 * @throws {RetryExhaustionError} If push fails after all retries
 */
export async function pushRefspecWithRetry(
  gitWorktree: GitAdapter,
  mainGit: GitAdapter,
  remote: string,
  localRef: string,
  remoteRef: string,
  reason: string,
  logPrefix: string = DEFAULT_LOG_PREFIX,
  config: PushRetryConfig = DEFAULT_PUSH_RETRY_CONFIG,
): Promise<void> {
  // If retry is disabled, just try once and throw on failure
  if (!config.enabled) {
    console.log(`${logPrefix} Pushing to ${remote}/${remoteRef} (push-only, retry disabled)...`);
    await pushRefspecWithForce(gitWorktree, remote, localRef, remoteRef, reason);
    console.log(`${logPrefix} ✅ Pushed to ${remote}/${remoteRef}`);
    return;
  }

  let attemptNumber = 0;

  await pRetry(
    async () => {
      attemptNumber++;
      console.log(
        `${logPrefix} Pushing to ${remote}/${remoteRef} (push-only, attempt ${attemptNumber}/${config.retries})...`,
      );

      try {
        await pushRefspecWithForce(gitWorktree, remote, localRef, remoteRef, reason);
        console.log(`${logPrefix} ✅ Pushed to ${remote}/${remoteRef}`);
      } catch (pushErr: unknown) {
        console.log(
          `${logPrefix} ⚠️  Push failed (origin moved). Fetching and rebasing before retry...`,
        );

        // Fetch latest origin/main
        console.log(`${logPrefix} Fetching ${remote}/${remoteRef}...`);
        await mainGit.fetch(remote, remoteRef);

        // Rebase temp branch onto updated main
        console.log(`${logPrefix} Rebasing temp branch onto ${remoteRef}...`);
        await gitWorktree.rebase(remoteRef);

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
    // p-retry exhausted all retries, throw typed error
    throw new RetryExhaustionError('push-only', config.retries);
  });
}

/**
 * Execute an operation in a micro-worktree with full isolation
 *
 * This is the main entry point for micro-worktree operations.
 * Handles the full lifecycle: create temp branch, create worktree,
 * execute operation, merge, push, and cleanup.
 *
 * WU-1435: Added pushOnly option to keep local main pristine.
 * WU-2237: Added pre-creation cleanup of orphaned temp branches/worktrees.
 * WU-1337: Push-only path now uses retry with rebase.
 *
 * @param {Object} options - Options for the operation
 * @param {string} options.operation - Operation name (e.g., 'wu-create', 'wu-edit')
 * @param {string} options.id - WU ID (e.g., 'WU-123')
 * @param {string} options.logPrefix - Log prefix for console output
 * @param {boolean} [options.pushOnly=false] - Skip local main merge, push directly to origin/main
 * @param {Function} options.execute - Async function to execute in micro-worktree
 *   Receives: { worktreePath: string, gitWorktree: GitAdapter }
 *   Should return: { commitMessage: string, files: string[] }
 * @returns {Promise<Object>} Result with ref property for worktree creation
 * @throws {Error} If any step fails (cleanup still runs)
 */
export async function withMicroWorktree(
  options: WithMicroWorktreeOptions,
): Promise<WithMicroWorktreeResult> {
  const { operation, id, logPrefix = `[${operation}]`, execute, pushOnly = false } = options;

  const mainGit = getGitForCwd();

  // WU-1308: Check if remote operations should be skipped (local-only mode)
  const skipRemote = shouldSkipRemoteOperations();

  // WU-2237: Clean up any orphaned temp branch/worktree from previous interrupted operations
  // This makes the operation idempotent - a retry after crash/timeout will succeed
  await cleanupOrphanedMicroWorktree(operation, id, mainGit, logPrefix);

  // WU-1179: Fetch origin/main before starting to minimize race condition window
  // This ensures we start from the latest origin state, reducing push failures
  // WU-1308: Skip when git.requireRemote=false (local-only mode)
  if (!pushOnly && !skipRemote) {
    console.log(`${logPrefix} Fetching ${REMOTES.ORIGIN}/${BRANCHES.MAIN} before starting...`);
    await mainGit.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
    // Update local main to match origin/main
    await mainGit.merge(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`, { ffOnly: true });
    console.log(`${logPrefix} ✅ Local main synced with ${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);
  } else if (skipRemote) {
    console.log(`${logPrefix} Local-only mode (git.requireRemote=false): skipping origin sync`);
  }

  const tempBranchName = getTempBranchName(operation, id);
  const microWorktreePath = createMicroWorktreeDir(`${operation}-`);

  console.log(`${logPrefix} Using micro-worktree isolation (WU-1262)`);
  console.log(`${logPrefix} Temp branch: ${tempBranchName}`);
  console.log(`${logPrefix} Micro-worktree: ${microWorktreePath}`);
  if (pushOnly) {
    console.log(`${logPrefix} Push-only mode: local main will not be modified (WU-1435)`);
  }

  try {
    // Step 1: Create temp branch without switching
    console.log(`${logPrefix} Creating temp branch...`);
    await mainGit.createBranchNoCheckout(tempBranchName, BRANCHES.MAIN);

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

      // Get push_retry config from LumenFlow config
      const config = getConfig();
      const pushRetryConfig = config.git.push_retry || DEFAULT_PUSH_RETRY_CONFIG;

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
      await pushWithRetry(
        mainGit,
        gitWorktree,
        REMOTES.ORIGIN,
        BRANCHES.MAIN,
        tempBranchName,
        logPrefix,
      );

      return { ...result, ref: BRANCHES.MAIN };
    }
  } finally {
    // Cleanup (always runs)
    await cleanupMicroWorktree(microWorktreePath, tempBranchName, logPrefix);
  }
}
