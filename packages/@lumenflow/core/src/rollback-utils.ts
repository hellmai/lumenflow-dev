#!/usr/bin/env node
/**
 * Rollback Utilities for WU Tooling
 *
 * WU-1255: Per-file error tracking for robust rollback operations.
 * Ensures all files are attempted even if some fail, with clear error reporting.
 *
 * @see {@link packages/@lumenflow/cli/src/wu-done.ts} - Consumer (rollbackTransaction function)
 */

import { writeFileSync, unlinkSync } from 'node:fs';

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
 * @class
 */
export class RollbackResult {
  /** Names of successfully restored files */
  restored: string[];
  /** Failed file restorations */
  errors: RollbackError[];

  constructor() {
    this.restored = [];
    this.errors = [];
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
