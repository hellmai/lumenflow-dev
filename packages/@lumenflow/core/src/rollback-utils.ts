#!/usr/bin/env node
/**
 * Rollback Utilities for WU Tooling
 *
 * WU-1255: Per-file error tracking for robust rollback operations.
 * Ensures all files are attempted even if some fail, with clear error reporting.
 *
 * WU-1665: Adds rollbackFromPipelineState for state-machine-driven recovery.
 * Centralized entry point that determines rollback actions from pipeline state.
 *
 * @see {@link packages/@lumenflow/cli/src/wu-done.ts} - Consumer (rollbackTransaction function)
 */

import { writeFileSync, unlinkSync } from 'node:fs';
import type { RollbackScope } from './wu-recovery.js';

/**
 * Error entry for failed file restoration
 */
interface RollbackError {
  name: string;
  path: string;
  error: string;
}

/**
 * Result of a rollback operation.
 * Tracks which files were restored and which failed.
 *
 * WU-1665: Extended with optional scope metadata for state-machine-driven recovery.
 *
 * @class
 */
export class RollbackResult {
  /** Names of successfully restored files */
  restored: string[];
  /** Failed file restorations */
  errors: RollbackError[];
  /** WU-1665: Rollback scope from pipeline state (set by rollbackFromPipelineState) */
  scope: RollbackScope | null;

  constructor() {
    this.restored = [];
    this.errors = [];
    this.scope = null;
  }

  /**
   * Record a successful file restoration.
   * @param {string} name - File identifier (e.g., 'backlog.md')
   */
  addSuccess(name) {
    this.restored.push(name);
  }

  /**
   * Record a failed file restoration.
   * @param {string} name - File identifier
   * @param {string} path - Full file path
   * @param {string} error - Error message
   */
  addError(name, path, error) {
    this.errors.push({ name, path, error });
  }

  /**
   * Check if all files were restored successfully.
   * @returns {boolean} True if no errors occurred
   */
  get success() {
    return this.errors.length === 0;
  }
}

/**
 * Restore multiple files with per-file error tracking.
 *
 * Each file is restored independently - if one fails, subsequent files
 * are still attempted. This ensures maximum recovery even in partial
 * failure scenarios.
 *
 * @param {Array<{name: string, path: string, content: string}>} filesToRestore - Files to restore
 * @returns {RollbackResult} Result with restored files and any errors
 *
 * @example
 * const result = rollbackFiles([
 *   { name: 'backlog.md', path: '/path/to/backlog.md', content: 'original content' },
 *   { name: 'status.md', path: '/path/to/status.md', content: 'original content' },
 * ]);
 *
 * if (!result.success) {
 *   console.error('Rollback had errors:', result.errors);
 * }
 */
export function rollbackFiles(filesToRestore) {
  const result = new RollbackResult();

  for (const file of filesToRestore) {
    try {
      writeFileSync(file.path, file.content, { encoding: 'utf-8' });
      result.addSuccess(file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.addError(file.name, file.path, message);
    }
  }

  return result;
}

/**
 * Delete multiple files with per-file error tracking.
 *
 * @param {Array<{name: string, path: string}>} filesToDelete - Files to delete
 * @returns {RollbackResult} Result with deleted files and any errors
 */
export function deleteFiles(filesToDelete) {
  const result = new RollbackResult();

  for (const file of filesToDelete) {
    try {
      unlinkSync(file.path);
      result.addSuccess(file.name);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.addError(file.name, file.path, message);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// WU-1665: State-machine-driven rollback entry point
// ---------------------------------------------------------------------------

/**
 * Input for the centralized pipeline-state-aware rollback.
 */
export interface PipelineRollbackInput {
  /** The pipeline state where failure occurred (from machine context.failedAt) */
  failedAt: string | null;
  /** Snapshot map of file paths to original content (from createTransactionSnapshot) */
  snapshot: Map<string, string | null> | null;
  /** Files to restore via the legacy per-file rollback path */
  filesToRestore: Array<{ name: string; path: string; content: string }>;
}

/**
 * WU-1665: Centralized rollback entry point driven by pipeline state.
 *
 * Determines the rollback scope from the failedAt state, then executes
 * the appropriate rollback actions. This replaces the scattered rollback
 * logic that was previously duplicated across wu-recovery.ts, wu-transaction.ts,
 * and the CLI orchestrator.
 *
 * Scope determination:
 * - validating/preparing/gating: no-op (nothing was written)
 * - committing: restore files from snapshot or filesToRestore
 * - merging/pushing: restore files + flag branch rollback needed
 * - cleaningUp: flag worktree cleanup only (push already succeeded)
 *
 * @param {PipelineRollbackInput} input - Rollback inputs
 * @returns {RollbackResult} Result with scope metadata and file restoration details
 */
export function rollbackFromPipelineState(input: PipelineRollbackInput): RollbackResult {
  const { failedAt, snapshot, filesToRestore } = input;
  const result = new RollbackResult();

  // Determine scope from failedAt state (same logic as StateMachineRecoveryManager)
  const scope = computeRollbackScope(failedAt);
  result.scope = scope;

  // If no file restoration needed, return early with scope metadata
  if (!scope.snapshotRestore) {
    return result;
  }

  // Restore files using snapshot if available, otherwise fall back to filesToRestore
  if (snapshot && snapshot.size > 0) {
    for (const [filePath, content] of snapshot) {
      try {
        if (content === null) {
          // File didn't exist before - delete if created
          try {
            unlinkSync(filePath);
            result.addSuccess(filePath);
          } catch {
            // File might not exist, which is fine
            result.addSuccess(filePath);
          }
        } else {
          writeFileSync(filePath, content, { encoding: 'utf-8' });
          result.addSuccess(filePath);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.addError(filePath, filePath, message);
      }
    }
  } else if (filesToRestore.length > 0) {
    // Legacy-compatible file restoration
    const legacyResult = rollbackFiles(filesToRestore);
    result.restored.push(...legacyResult.restored);
    result.errors.push(...legacyResult.errors);
  }

  return result;
}

/**
 * WU-1665: Compute rollback scope from pipeline failedAt state.
 *
 * Pure function: given the same failedAt, always returns the same scope.
 * This is the canonical scope determination used by both
 * StateMachineRecoveryManager.getRollbackScope() and rollbackFromPipelineState().
 *
 * @param {string|null} failedAt - Pipeline state where failure occurred
 * @returns {RollbackScope} Rollback scope
 */
export function computeRollbackScope(failedAt: string | null): RollbackScope {
  // Pre-write states: nothing to roll back
  if (!failedAt || failedAt === 'validating' || failedAt === 'preparing' || failedAt === 'gating') {
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
  return {
    snapshotRestore: true,
    branchRollback: true,
    worktreeCleanup: false,
  };
}
