// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU Recovery Module
 *
 * Handles zombie state recovery (status=done but worktree still exists)
 * Fixes WU-1159 gap by ensuring status.md AND backlog.md are updated
 *
 * Zombie states occur when wu:done crashes mid-execution:
 * - WU YAML updated to status=done
 * - But cleanup incomplete (worktree exists, docs not updated, etc.)
 *
 * Recovery mode is idempotent - safe to run multiple times
 *
 * NOTE (WU-1826): Core recovery functions are now re-exported from
 * tools/lib/wu-repair-core.ts for use by the unified wu:repair command.
 * This module remains the canonical implementation used by wu-done.ts.
 *
 * WU-1665: Adds state-machine-driven recovery consolidation.
 * - StateMachineRecoveryManager determines rollback scope from pipeline failedAt state.
 * - Legacy rollback path retained behind LUMENFLOW_LEGACY_ROLLBACK=1 env flag.
 * - All recovery is now centralized through state-machine semantics by default.
 */

import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, isAbsolute } from 'node:path';
import { RECOVERY } from './wu-done-messages.js';
import { createStamp } from './stamp-utils.js';
import { WU_PATHS } from './wu-paths.js';
import { writeWU } from './wu-yaml.js';
import { updateStatusRemoveInProgress, addToStatusCompleted } from './wu-status-updater.js';
import { moveWUToDoneBacklog } from './wu-backlog-updater.js';
import { getGitForCwd } from './git-adapter.js';
import { createError, ErrorCodes, getErrorMessage } from './error-handler.js';
import { rollbackFiles } from './rollback-utils.js';
import { LOG_PREFIX, EMOJI, WU_STATUS, getProjectRoot, LUMENFLOW_PATHS } from './wu-constants.js';

import { RETRY_PRESETS } from './retry-strategy.js';

/**
 * WU-1335: Maximum number of recovery attempts before escalating to manual intervention
 * WU-1747: Now derived from the recovery retry preset for consistency
 */
export const MAX_RECOVERY_ATTEMPTS = RETRY_PRESETS.recovery.maxAttempts;

/**
 * WU-1335: Recovery marker subdirectory within .lumenflow
 */
const RECOVERY_MARKER_DIR = 'recovery';

interface RecoveryMarkerData {
  attempts?: number;
  lastAttempt?: string;
  wuId?: string;
}

interface RecoveryFilePaths {
  wuPath: string;
  statusPath: string;
  backlogPath: string;
  stampPath: string;
}

interface RecoveryTransactionState {
  wuContent: string | null;
  statusContent: string | null;
  backlogContent: string | null;
  stampExisted: boolean;
  timestamp: string;
}

interface RecoveryDoc extends Record<string, unknown> {
  title?: string;
  status?: string;
  locked?: boolean;
  completed_at?: string;
  completed?: string | boolean;
}

interface ResetWorktreeYAMLForRecoveryParams {
  worktreePath: string;
  id: string;
  doc: RecoveryDoc;
}

interface RecoverZombieStateParams {
  id: string;
  doc: RecoveryDoc;
  _worktreePath?: string;
  _args?: unknown;
}

interface RecoverZombieStateResults {
  stamp: { created: boolean; path: string; reason?: string } | null;
  yaml: { updated: boolean; reason?: string } | null;
  docs: { status: unknown | null; backlog: unknown | null };
  commit?: { committed: boolean; reason?: string };
}

/**
 * WU-1335: Get the path to the recovery marker file for a WU
 *
 * @param {string} id - WU ID
 * @param {string} [baseDir=process.cwd()] - Base directory for .lumenflow
 * @returns {string} Path to recovery marker file
 */
export function getRecoveryMarkerPath(id: string, baseDir = process.cwd()): string {
  return join(baseDir, LUMENFLOW_PATHS.BASE, RECOVERY_MARKER_DIR, `${id}.recovery`);
}

/**
 * WU-1335: Get the current recovery attempt count for a WU
 *
 * @param {string} id - WU ID
 * @param {string} [baseDir=process.cwd()] - Base directory for .lumenflow
 * @returns {number} Current attempt count (0 if no marker exists)
 */
export function getRecoveryAttemptCount(id: string, baseDir = process.cwd()): number {
  const markerPath = getRecoveryMarkerPath(id, baseDir);
  if (!existsSync(markerPath)) {
    return 0;
  }
  try {
    const data = JSON.parse(readFileSync(markerPath, { encoding: 'utf-8' })) as RecoveryMarkerData;
    return typeof data.attempts === 'number' ? data.attempts : 0;
  } catch {
    // Corrupted file - treat as 0
    return 0;
  }
}

/**
 * WU-1335: Increment recovery attempt count for a WU
 *
 * @param {string} id - WU ID
 * @param {string} [baseDir=process.cwd()] - Base directory for .lumenflow
 * @returns {number} New attempt count
 */
export function incrementRecoveryAttempt(id: string, baseDir = process.cwd()): number {
  const markerPath = getRecoveryMarkerPath(id, baseDir);
  const markerDir = join(baseDir, LUMENFLOW_PATHS.BASE, RECOVERY_MARKER_DIR);

  // Ensure directory exists
  if (!existsSync(markerDir)) {
    mkdirSync(markerDir, { recursive: true });
  }

  const currentCount = getRecoveryAttemptCount(id, baseDir);
  const newCount = currentCount + 1;

  const data = {
    attempts: newCount,
    lastAttempt: new Date().toISOString(),
    wuId: id,
  };

  writeFileSync(markerPath, JSON.stringify(data, null, 2));
  return newCount;
}

/**
 * WU-1335: Clear recovery attempts for a WU (called on successful recovery)
 *
 * @param {string} id - WU ID
 * @param {string} [baseDir=process.cwd()] - Base directory for .lumenflow
 */
export function clearRecoveryAttempts(id: string, baseDir = process.cwd()): void {
  const markerPath = getRecoveryMarkerPath(id, baseDir);
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
  }
}

/**
 * WU-1335: Check if recovery should escalate to manual intervention
 *
 * @param {number} attempts - Current attempt count
 * @returns {boolean} True if should escalate
 */
export function shouldEscalateToManualIntervention(attempts: number): boolean {
  return attempts >= MAX_RECOVERY_ATTEMPTS;
}

/**
 * Record initial state for atomic rollback (WU-1303)
 *
 * @param {object} paths - Object containing file paths
 * @param {string} paths.wuPath - Path to WU YAML
 * @param {string} paths.statusPath - Path to status.md
 * @param {string} paths.backlogPath - Path to backlog.md
 * @param {string} paths.stampPath - Path to stamp file
 * @returns {object} Transaction state for rollback
 */
function recordRecoveryState(paths: RecoveryFilePaths): RecoveryTransactionState {
  const { wuPath, statusPath, backlogPath, stampPath } = paths;
  return {
    wuContent: existsSync(wuPath) ? readFileSync(wuPath, { encoding: 'utf-8' }) : null,
    statusContent: existsSync(statusPath) ? readFileSync(statusPath, { encoding: 'utf-8' }) : null,
    backlogContent: existsSync(backlogPath)
      ? readFileSync(backlogPath, { encoding: 'utf-8' })
      : null,
    stampExisted: existsSync(stampPath),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Rollback recovery transaction on failure (WU-1303)
 *
 * @param {object} state - Transaction state from recordRecoveryState
 * @param {object} paths - Object containing file paths
 */
function rollbackRecoveryTransaction(
  state: RecoveryTransactionState,
  paths: RecoveryFilePaths,
): void {
  const { wuPath, statusPath, backlogPath, stampPath } = paths;

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Rolling back recovery transaction...`);

  // Build list of files to restore
  const filesToRestore = [];

  if (state.wuContent !== null) {
    filesToRestore.push({ name: 'WU YAML', path: wuPath, content: state.wuContent });
  }
  if (state.statusContent !== null) {
    filesToRestore.push({ name: 'status.md', path: statusPath, content: state.statusContent });
  }
  if (state.backlogContent !== null) {
    filesToRestore.push({ name: 'backlog.md', path: backlogPath, content: state.backlogContent });
  }

  // Restore files
  if (filesToRestore.length > 0) {
    const result = rollbackFiles(filesToRestore);
    for (const name of result.restored) {
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Restored ${name}`);
    }
    for (const err of result.errors) {
      console.error(
        `${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Failed to restore ${err.name}: ${err.error}`,
      );
    }
  }

  // Remove stamp if it was created during recovery
  if (!state.stampExisted && existsSync(stampPath)) {
    try {
      unlinkSync(stampPath);
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Removed stamp file`);
    } catch (err: unknown) {
      console.error(
        `${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Failed to remove stamp: ${getErrorMessage(err)}`,
      );
    }
  }

  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Rollback complete - main checkout is clean`);
}

/**
 * Detect zombie state
 *
 * @param {object} doc - WU YAML document
 * @param {string|null} worktreePath - Path to worktree
 * @returns {boolean} True if zombie state detected
 */
export function detectZombieState(doc: { status?: string }, worktreePath: string | null): boolean {
  if (!worktreePath) {
    return false;
  }
  return doc.status === WU_STATUS.DONE && existsSync(worktreePath);
}

/**
 * WU-1440: Reset worktree WU YAML to in_progress for recovery
 *
 * Instead of committing directly to main (old recovery mode), this function
 * resets the worktree YAML so the normal wu:done merge flow can proceed.
 *
 * Removes completion markers:
 * - status → in_progress
 * - locked → removed
 * - completed_at → removed
 *
 * Preserves all other fields (description, acceptance, code_paths, etc.)
 *
 * @param {object} params - Recovery parameters
 * @param {string} params.worktreePath - Path to worktree root
 * @param {string} params.id - WU ID
 * @param {object} params.doc - WU YAML document (will be mutated)
 * @returns {{ reset: boolean }} Reset result
 */
export function resetWorktreeYAMLForRecovery({
  worktreePath,
  id,
  doc,
}: ResetWorktreeYAMLForRecoveryParams): { reset: boolean } {
  const projectRoot = getProjectRoot(import.meta.url);
  const resolvedWorktreeRoot = isAbsolute(worktreePath)
    ? worktreePath
    : join(projectRoot, worktreePath);
  const wtWUPath = join(resolvedWorktreeRoot, WU_PATHS.WU(id));

  // Reset status to in_progress
  doc.status = WU_STATUS.IN_PROGRESS;

  // Remove completion markers (delete from object)
  delete doc.locked;
  delete doc.completed_at;

  // Write updated YAML to worktree
  writeWU(wtWUPath, doc);

  console.log(
    `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Reset worktree YAML to in_progress for recovery`,
  );

  return { reset: true };
}

// Note: updateBacklogMd removed (WU-1163) - now uses shared moveWUToDoneBacklog from wu-backlog-updater.ts

/**
 * Recover from zombie state
 *
 * THE COMPLETE FIX for WU-1159 gap:
 * - Ensures stamp exists
 * - Ensures YAML completion markers
 * - Ensures status.md updated (THE FIX)
 * - Ensures backlog.md updated (THE FIX)
 *
 * All operations are idempotent - safe to run multiple times
 *
 * WU-1303: Added atomic rollback - if UnsafeAny operation fails, all files are
 * restored to their original state to prevent leaving main checkout dirty.
 *
 * @param {object} params - Recovery parameters
 * @param {string} params.id - WU ID
 * @param {object} params.doc - WU YAML document
 * @param {string} params.worktreePath - Path to worktree
 * @param {object} params.args - Command-line args
 * @returns {object} Recovery results
 */
export async function recoverZombieState({
  id,
  doc,
  _worktreePath,
  _args,
}: RecoverZombieStateParams): Promise<RecoverZombieStateResults> {
  console.log(`\n${RECOVERY.DETECTED}`);
  console.log(RECOVERY.RESUMING);
  console.log(RECOVERY.EXPLANATION);

  const results: RecoverZombieStateResults = {
    stamp: null,
    yaml: null,
    docs: { status: null, backlog: null },
  };

  // WU-1303: Record file state BEFORE UnsafeAny modifications for atomic rollback
  const wuPath = WU_PATHS.WU(id);
  const statusPath = WU_PATHS.STATUS();
  const backlogPath = WU_PATHS.BACKLOG();
  const stampPath = WU_PATHS.STAMP(id);

  const paths = { wuPath, statusPath, backlogPath, stampPath };
  const initialState = recordRecoveryState(paths);

  try {
    // 1. Ensure stamp exists (idempotent)
    console.log(RECOVERY.CREATING_STAMP);
    results.stamp = createStamp({ id, title: doc.title ?? id });
    console.log(RECOVERY.STAMP_CREATED);

    // 2. Ensure YAML completion markers (idempotent)
    console.log(RECOVERY.UPDATING_YAML);
    let yamlUpdated = false;
    if (doc.locked !== true) {
      doc.locked = true;
      yamlUpdated = true;
    }
    if (!doc.completed_at && !doc.completed) {
      doc.completed_at = new Date().toISOString();
      yamlUpdated = true;
    }
    if (yamlUpdated) {
      writeWU(wuPath, doc);
      results.yaml = { updated: true };
    } else {
      results.yaml = { updated: false, reason: 'already_complete' };
    }
    console.log(RECOVERY.YAML_UPDATED);

    // 3. **FIX WU-1159 GAP**: Update status.md and backlog.md (idempotent)
    console.log(RECOVERY.UPDATING_DOCS);

    updateStatusRemoveInProgress(statusPath, id);
    addToStatusCompleted(statusPath, id, doc.title ?? id);
    results.docs.status = { updated: true };

    await moveWUToDoneBacklog(backlogPath, id, doc.title ?? id);
    results.docs.backlog = { updated: true };

    console.log(RECOVERY.DOCS_UPDATED);

    // 4. **FIX WU-1201**: Commit recovery changes to prevent data loss
    // Check if git status is dirty (files were updated)
    const git = getGitForCwd();
    const statusOutput = await git.getStatus();
    if (statusOutput && statusOutput.trim()) {
      console.log(RECOVERY.COMMITTING);

      try {
        await git.add([stampPath, wuPath, statusPath, backlogPath]);
        // WU-1383: Set recovery mode env var to bypass stamp existence check in validate.ts
        // During recovery, stamp and status=done are committed atomically, but pre-commit
        // hooks run mid-commit when both files are staged but validation sees inconsistent state
        process.env.WU_RECOVERY_ID = id;
        try {
          await git.commit(`chore(recovery): complete wu:done metadata for ${id}`);
        } finally {
          // Always clean up env var (WU-1383)
          delete process.env.WU_RECOVERY_ID;
        }
        results.commit = { committed: true };
        console.log(RECOVERY.COMMIT_SUCCESS);
      } catch (commitError: unknown) {
        const commitMessage = getErrorMessage(commitError);
        // Commit failed - rollback all changes (WU-1303)
        console.warn(RECOVERY.COMMIT_FAILED(commitMessage));
        rollbackRecoveryTransaction(initialState, paths);

        throw createError(
          ErrorCodes.GIT_ERROR,
          `Recovery commit failed: ${commitMessage}\nFiles rolled back to clean state. Re-run wu:done to retry.`,
          { originalError: commitMessage, wuId: id },
        );
      }
    } else {
      results.commit = { committed: false, reason: 'no_changes' };
    }

    console.log(RECOVERY.MARKERS_VERIFIED);
    console.log(RECOVERY.PROCEEDING_CLEANUP);

    return results;
  } catch (error: unknown) {
    // WU-1303: Atomic rollback on ANY failure (not just commit)
    // Re-throw if it's already a structured error (from commit phase)
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === ErrorCodes.GIT_ERROR
    ) {
      throw error;
    }

    const message = getErrorMessage(error);

    // Rollback file changes for non-commit errors
    console.error(`${LOG_PREFIX.DONE} ${EMOJI.FAILURE} Recovery failed: ${message}`);
    rollbackRecoveryTransaction(initialState, paths);

    throw createError(
      ErrorCodes.RECOVERY_ERROR,
      `Recovery operation failed: ${message}\nFiles rolled back to clean state. Re-run wu:done to retry.`,
      { originalError: message, wuId: id },
    );
  }
}

// ---------------------------------------------------------------------------
// WU-1665: State-machine-driven recovery consolidation
// ---------------------------------------------------------------------------

/**
 * WU-1665: Environment variable key for legacy rollback compatibility guard.
 * When set to "1", the legacy rollback path is used instead of state-machine-driven recovery.
 */
export const LUMENFLOW_LEGACY_ROLLBACK_ENV_KEY = 'LUMENFLOW_LEGACY_ROLLBACK';

/**
 * WU-1665: Check if legacy rollback mode is enabled via environment variable.
 *
 * During the migration window, operators can set LUMENFLOW_LEGACY_ROLLBACK=1
 * to use the pre-WU-1665 recovery path for rollback operations.
 *
 * @returns {boolean} True if legacy rollback is enabled
 */
export function isLegacyRollbackEnabled(): boolean {
  return process.env[LUMENFLOW_LEGACY_ROLLBACK_ENV_KEY] === '1';
}

/**
 * WU-1665: Rollback scope determined by the pipeline state where failure occurred.
 *
 * Maps each pipeline stage to the recovery actions needed:
 * - validating/preparing: nothing written, no rollback needed
 * - gating: nothing written (gates are read-only checks), no rollback needed
 * - committing: files written to disk, need snapshot restore
 * - merging: committed to worktree branch, need snapshot + branch rollback
 * - pushing: merged but push failed, need snapshot + branch rollback
 * - cleaningUp: push succeeded, only worktree cleanup remains
 */
export interface RollbackScope {
  /** Whether file snapshot restore is needed (files were written to disk) */
  snapshotRestore: boolean;
  /** Whether branch-level rollback is needed (commits were made) */
  branchRollback: boolean;
  /** Whether worktree cleanup is the remaining action (push already succeeded) */
  worktreeCleanup: boolean;
}

/**
 * WU-1665: Recovery state from the XState pipeline snapshot.
 */
export interface PipelineRecoveryState {
  wuId: string;
  failedAt: string | null;
  error: string | null;
  retryCount: number;
}

/**
 * WU-1665: State-machine-driven recovery manager.
 *
 * Determines rollback scope from the pipeline's failedAt state, replacing
 * the ad-hoc per-function rollback logic scattered across wu-recovery.ts,
 * wu-transaction.ts, and rollback-utils.ts.
 *
 * Usage:
 * ```ts
 * const manager = new StateMachineRecoveryManager({
 *   wuId: 'WU-1665',
 *   failedAt: 'committing',
 *   error: 'git commit failed',
 *   retryCount: 0,
 * });
 * const scope = manager.getRollbackScope();
 * // scope.snapshotRestore === true
 * // scope.branchRollback === false
 * ```
 */
export class StateMachineRecoveryManager {
  readonly wuId: string;
  readonly failedAt: string | null;
  readonly error: string | null;
  readonly retryCount: number;

  constructor(state: PipelineRecoveryState) {
    this.wuId = state.wuId;
    this.failedAt = state.failedAt;
    this.error = state.error;
    this.retryCount = state.retryCount;
  }

  /**
   * Determine rollback scope based on the pipeline stage where failure occurred.
   *
   * The scope is deterministic: given the same failedAt state, the same
   * rollback actions are always prescribed.
   */
  getRollbackScope(): RollbackScope {
    const failedAt = this.failedAt;

    // Pre-write states: nothing to roll back
    if (
      !failedAt ||
      failedAt === 'validating' ||
      failedAt === 'preparing' ||
      failedAt === 'gating'
    ) {
      return {
        snapshotRestore: false,
        branchRollback: false,
        worktreeCleanup: false,
      };
    }

    // Post-push state: push already succeeded, only cleanup remains
    if (failedAt === 'cleaningUp') {
      return {
        snapshotRestore: false,
        branchRollback: false,
        worktreeCleanup: true,
      };
    }

    // Commit-phase failures: files written, need snapshot restore
    if (failedAt === 'committing') {
      return {
        snapshotRestore: true,
        branchRollback: false,
        worktreeCleanup: false,
      };
    }

    // Merge/push phase failures: committed + potentially merged, need full rollback
    // (merging, pushing)
    return {
      snapshotRestore: true,
      branchRollback: true,
      worktreeCleanup: false,
    };
  }

  /**
   * Serialize recovery state for persistence (e.g., to .lumenflow/recovery/).
   */
  serialize(): string {
    return JSON.stringify({
      wuId: this.wuId,
      failedAt: this.failedAt,
      error: this.error,
      retryCount: this.retryCount,
      serializedAt: new Date().toISOString(),
    });
  }

  /**
   * Deserialize recovery state from persisted JSON.
   */
  static deserialize(json: string): StateMachineRecoveryManager {
    const data = JSON.parse(json) as PipelineRecoveryState;
    return new StateMachineRecoveryManager(data);
  }
}
