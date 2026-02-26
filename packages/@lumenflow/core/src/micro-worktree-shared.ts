// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared micro-worktree helpers used by multiple workflows.
 *
 * Extracted from micro-worktree.ts (WU-1626) to support atomic merge flows
 * without importing the full withMicroWorktree orchestration module.
 */

import { getGitForCwd } from './git-adapter.js';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pRetry from 'p-retry';
import { BRANCHES, REMOTES } from './wu-constants.js';
import { getConfig } from './lumenflow-config.js';
import type { GitAdapter } from './git-adapter.js';
import type { PushRetryConfig } from './lumenflow-config-schema.js';

type MicroWorktreeSyncGitAdapter = Pick<GitAdapter, 'fetch' | 'merge'>;
type MicroWorktreeCleanupGitAdapter = Pick<
  GitAdapter,
  'worktreeRemove' | 'worktreeList' | 'branchExists' | 'deleteBranch'
>;

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
 * Can be overridden via workspace.yaml software_delivery.git.push_retry.
 */
export const DEFAULT_PUSH_RETRY_CONFIG: PushRetryConfig = {
  enabled: true,
  retries: 3,
  min_delay_ms: 100,
  max_delay_ms: 1000,
  jitter: true,
};

/**
 * Resolve effective push retry config from defaults + global config + operation override.
 *
 * Priority (lowest to highest):
 * 1. DEFAULT_PUSH_RETRY_CONFIG
 * 2. Global config from workspace.yaml software_delivery (`git.push_retry`)
 * 3. Operation-specific override from caller
 */
export function resolvePushRetryConfig(
  globalConfig?: Partial<PushRetryConfig>,
  operationOverride?: Partial<PushRetryConfig>,
): PushRetryConfig {
  return {
    ...DEFAULT_PUSH_RETRY_CONFIG,
    ...(globalConfig || {}),
    ...(operationOverride || {}),
  };
}

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
 * Environment variable name for LUMENFLOW_WU_TOOL
 *
 * WU-1365: Exported for use by CLI commands that use micro-worktree operations.
 * The pre-push hook checks this env var to allow micro-worktree pushes to main.
 * Valid values are: wu-create, wu-edit, wu-done, wu-delete, wu-claim, wu-block,
 * wu-unblock, initiative-create, initiative-edit, release, lumenflow-upgrade
 */
export const LUMENFLOW_WU_TOOL_ENV = 'LUMENFLOW_WU_TOOL';

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
 */
export class RetryExhaustionError extends Error {
  readonly name = 'RetryExhaustionError';
  readonly operation: string;
  readonly retries: number;

  constructor(operation: string, retries: number) {
    super(
      `Push failed after ${retries} attempts. ` +
        `Origin main may have significant traffic during ${operation}.`,
    );
    this.operation = operation;
    this.retries = retries;
    Object.setPrototypeOf(this, RetryExhaustionError.prototype);
  }
}

/**
 * WU-1336: Options for formatting retry exhaustion error messages
 */
export interface FormatRetryExhaustionOptions {
  command: string;
}

/**
 * WU-1336: Type guard to check if an error is a retry exhaustion error
 *
 * Detects both the typed `RetryExhaustionError` class and legacy error messages
 * that match the "Push failed after N attempts" pattern.
 */
export function isRetryExhaustionError(error: unknown): error is Error {
  if (error instanceof RetryExhaustionError) {
    return true;
  }

  if (error instanceof Error) {
    return RETRY_EXHAUSTION_PATTERN.test(error.message);
  }

  return false;
}

/**
 * WU-1336: Format retry exhaustion error with actionable next steps
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
    `  3. Consider increasing git.push_retry.retries in workspace.yaml software_delivery`
  );
}

/**
 * WU-1308: Check if remote operations should be skipped based on git.requireRemote config
 */
export function shouldSkipRemoteOperations(): boolean {
  const config = getConfig();
  return config.git.requireRemote === false;
}

export interface MicroWorktreeSyncPreambleOptions {
  mainGit?: MicroWorktreeSyncGitAdapter;
  logPrefix: string;
  pushOnly: boolean;
  skipRemote: boolean;
}

export interface MicroWorktreeSyncPreambleResult {
  baseRef: string;
}

/**
 * WU-2203: Run the micro-worktree sync preamble and compute the base ref.
 *
 * Preserves existing behavior for pushOnly/skipRemote modes:
 * - standard mode syncs local main to origin/main
 * - pushOnly mode only refreshes origin/main tracking ref
 * - local-only mode skips remote operations entirely
 */
export async function runMicroWorktreeSyncPreamble(
  options: MicroWorktreeSyncPreambleOptions,
): Promise<MicroWorktreeSyncPreambleResult> {
  const { logPrefix, pushOnly, skipRemote } = options;
  const mainGit = options.mainGit ?? getGitForCwd();

  if (!skipRemote) {
    console.log(`${logPrefix} Fetching ${REMOTES.ORIGIN}/${BRANCHES.MAIN} before starting...`);
    await mainGit.fetch(REMOTES.ORIGIN, BRANCHES.MAIN);
    if (pushOnly) {
      console.log(
        `${logPrefix} ✅ Push-only mode will base from ${REMOTES.ORIGIN}/${BRANCHES.MAIN}; local main unchanged (WU-1672)`,
      );
    } else {
      // Update local main to match origin/main for standard mode.
      await mainGit.merge(`${REMOTES.ORIGIN}/${BRANCHES.MAIN}`, { ffOnly: true });
      console.log(`${logPrefix} ✅ Local main synced with ${REMOTES.ORIGIN}/${BRANCHES.MAIN}`);
    }
  } else if (skipRemote) {
    console.log(`${logPrefix} Local-only mode (git.requireRemote=false): skipping origin sync`);
  }

  const baseRef = pushOnly && !skipRemote ? `${REMOTES.ORIGIN}/${BRANCHES.MAIN}` : BRANCHES.MAIN;
  return { baseRef };
}

/**
 * Temp branch prefix for micro-worktree operations
 */
export function getTempBranchName(operation: string, id: string): string {
  return `${BRANCHES.TEMP_PREFIX}${operation}/${id.toLowerCase()}`;
}

/**
 * Create micro-worktree in /tmp directory
 */
export function createMicroWorktreeDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/**
 * Parse git worktree list output to find worktrees by branch
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
        tryFilesystemCleanup(orphanWorktreePath);
        cleanedWorktree = true;
      }
    }
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.warn(`${logPrefix} ⚠️  Could not check worktree list: ${errMsg}`);
  }

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

function tryFilesystemCleanup(worktreePath: string): void {
  try {
    if (existsSync(worktreePath)) {
      rmSync(worktreePath, { recursive: true, force: true });
    }
  } catch {
    // Ignore filesystem cleanup errors
  }
}

async function removeWorktreeSafe(
  gitAdapter: MicroWorktreeCleanupGitAdapter,
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
 */
export async function cleanupMicroWorktree(
  worktreePath: string,
  branchName: string,
  logPrefix: string = DEFAULT_LOG_PREFIX,
  mainGitAdapter?: MicroWorktreeCleanupGitAdapter,
): Promise<void> {
  console.log(`${logPrefix} Cleaning up micro-worktree...`);
  const mainGit = mainGitAdapter ?? getGitForCwd();

  if (existsSync(worktreePath)) {
    await removeWorktreeSafe(mainGit, worktreePath, logPrefix);
  }

  await cleanupRegisteredWorktreeForBranch(mainGit, branchName, worktreePath, logPrefix);
  await deleteBranchSafe(mainGit, branchName, logPrefix);

  console.log(`${logPrefix} ✅ Cleanup complete`);
}

async function cleanupRegisteredWorktreeForBranch(
  gitAdapter: MicroWorktreeCleanupGitAdapter,
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

async function deleteBranchSafe(
  gitAdapter: MicroWorktreeCleanupGitAdapter,
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
 * Push using refspec with LUMENFLOW_FORCE to bypass pre-push hooks
 */
export async function pushRefspecWithForce(
  gitAdapter: GitAdapter,
  remote: string,
  localRef: string,
  remoteRef: string,
  reason: string,
): Promise<void> {
  const originalForce = process.env[LUMENFLOW_FORCE_ENV];
  const originalReason = process.env[LUMENFLOW_FORCE_REASON_ENV];

  try {
    process.env[LUMENFLOW_FORCE_ENV] = '1';
    process.env[LUMENFLOW_FORCE_REASON_ENV] = reason;
    await gitAdapter.pushRefspec(remote, localRef, remoteRef);
  } finally {
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

        console.log(`${logPrefix} Fetching ${remote}/${remoteRef}...`);
        await mainGit.fetch(remote, remoteRef);

        const remoteTrackingRef = `${remote}/${remoteRef}`;
        console.log(`${logPrefix} Rebasing temp branch onto ${remoteTrackingRef}...`);
        await gitWorktree.rebase(remoteTrackingRef);

        throw pushErr;
      }
    },
    {
      retries: config.retries - 1,
      minTimeout: config.min_delay_ms,
      maxTimeout: config.max_delay_ms,
      randomize: config.jitter,
      onFailedAttempt: () => {
        // Logging handled in the retry body
      },
    },
  ).catch(() => {
    throw new RetryExhaustionError('push-only', config.retries);
  });
}
