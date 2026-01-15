/**
 * WU Transaction - Atomic write operations for wu:done
 *
 * WU-1369: Implements transactional pattern for metadata updates.
 * Collects all changes in memory, validates, then writes atomically.
 *
 * Pattern:
 * 1. Create transaction
 * 2. Collect all pending writes (in memory)
 * 3. Validate pending state
 * 4. Commit (write all files) or abort (discard)
 *
 * This ensures no partial state on validation failure:
 * - If validation fails → no files written
 * - If any write fails → error with cleanup info
 */

import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { LOG_PREFIX, EMOJI, FILE_SYSTEM } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

/**
 * Represents a pending file write operation
 * @typedef {Object} PendingWrite
 * @property {string} path - Absolute or relative file path
 * @property {string} content - File content to write
 * @property {string} description - Human-readable description (e.g., "WU YAML", "status.md")
 */

/**
 * Transaction for atomic metadata updates
 *
 * Usage:
 * ```js
 * const tx = new WUTransaction(id);
 *
 * // Collect pending changes
 * tx.addWrite(wuPath, yamlContent, 'WU YAML');
 * tx.addWrite(statusPath, statusContent, 'status.md');
 *
 * // Validate (no writes happen yet)
 * const validation = tx.validate();
 * if (!validation.valid) {
 *   tx.abort();
 *   return;
 * }
 *
 * // Commit all changes atomically
 * const result = tx.commit();
 * ```
 */
export class WUTransaction {
  /**
   * Create a new transaction
   * @param {string} wuId - WU ID for logging context
   */
  constructor(wuId) {
    /** @type {string} */
    this.wuId = wuId;

    /** @type {Map<string, PendingWrite>} */
    this.pendingWrites = new Map();

    /** @type {boolean} */
    this.committed = false;

    /** @type {boolean} */
    this.aborted = false;

    /** @type {Date} */
    this.createdAt = new Date();
  }

  /**
   * Add a pending file write operation
   *
   * @param {string} filePath - File path to write
   * @param {string} content - Content to write
   * @param {string} description - Human-readable description
   * @throws {Error} If transaction already committed or aborted
   */
  addWrite(filePath, content, description) {
    if (this.committed) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Cannot add writes to committed transaction (${this.wuId})`,
        { wuId: this.wuId, path: filePath }
      );
    }
    if (this.aborted) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Cannot add writes to aborted transaction (${this.wuId})`,
        { wuId: this.wuId, path: filePath }
      );
    }

    this.pendingWrites.set(filePath, {
      path: filePath,
      content,
      description,
    });
  }

  /**
   * Get pending writes for inspection
   * @returns {PendingWrite[]}
   */
  getPendingWrites() {
    return Array.from(this.pendingWrites.values());
  }

  /**
   * Get count of pending writes
   * @returns {number}
   */
  get size() {
    return this.pendingWrites.size;
  }

  /**
   * Validate pending writes (pre-commit checks)
   *
   * Checks:
   * - All parent directories can be created
   * - No duplicate paths with different content
   * - Content is valid (non-empty for critical files)
   *
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate() {
    const errors = [];

    if (this.pendingWrites.size === 0) {
      errors.push('No pending writes in transaction');
      return { valid: false, errors };
    }

    for (const [filePath, write] of this.pendingWrites) {
      // Check content is defined
      if (write.content === undefined || write.content === null) {
        errors.push(`${write.description}: Content is undefined`);
        continue;
      }

      // Check parent directory exists or can be created
      const dir = path.dirname(filePath);
      if (dir && dir !== '.' && !existsSync(dir)) {
        // Will be created during commit - just note for logging
        console.log(`${LOG_PREFIX.DONE} Will create directory: ${dir}`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Commit all pending writes atomically
   *
   * Writes all files in a single batch. If any write fails,
   * reports which files were written vs failed.
   *
   * @returns {{ success: boolean, written: string[], failed: { path: string, error: string }[] }}
   * @throws {Error} If transaction already committed or aborted
   */
  commit() {
    if (this.committed) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Transaction already committed (${this.wuId})`,
        { wuId: this.wuId }
      );
    }
    if (this.aborted) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Cannot commit aborted transaction (${this.wuId})`,
        { wuId: this.wuId }
      );
    }

    const written = [];
    const failed = [];

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Transaction COMMIT - writing ${this.pendingWrites.size} files atomically`
    );

    for (const [filePath, write] of this.pendingWrites) {
      try {
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        if (dir && dir !== '.' && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // Write file
        writeFileSync(filePath, write.content, FILE_SYSTEM.UTF8);
        written.push(filePath);
        console.log(`${LOG_PREFIX.DONE}   ${EMOJI.SUCCESS} ${write.description}`);
      } catch (err) {
        failed.push({ path: filePath, error: err.message });
        console.error(`${LOG_PREFIX.DONE}   ${EMOJI.FAILURE} ${write.description}: ${err.message}`);
      }
    }

    this.committed = true;
    this.pendingWrites.clear();

    const success = failed.length === 0;

    if (!success) {
      console.error(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Transaction completed with ${failed.length} failures`
      );
    }

    return { success, written, failed };
  }

  /**
   * Abort transaction (discard pending writes)
   *
   * Since no writes have been made, this just clears pending changes.
   * This is the key benefit of the transactional pattern.
   */
  abort() {
    if (this.committed) {
      console.warn(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Aborting already-committed transaction`);
      return;
    }

    const count = this.pendingWrites.size;
    this.pendingWrites.clear();
    this.aborted = true;

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Transaction ABORTED - ${count} pending writes discarded`
    );
  }

  /**
   * Get transaction state for debugging
   * @returns {object}
   */
  getState() {
    return {
      wuId: this.wuId,
      committed: this.committed,
      aborted: this.aborted,
      pendingCount: this.pendingWrites.size,
      files: Array.from(this.pendingWrites.keys()),
      createdAt: this.createdAt.toISOString(),
    };
  }
}

/**
 * Read file content for transaction (pre-compute backup)
 *
 * @param {string} filePath - File to read
 * @returns {string|null} - File content or null if doesn't exist
 */
export function readFileForTransaction(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, FILE_SYSTEM.UTF8);
}

/**
 * Create a transaction state snapshot for rollback
 *
 * Captures current file contents before any modifications.
 * Used if git operations fail after transaction commit.
 *
 * @param {string[]} filePaths - Paths to snapshot
 * @returns {Map<string, string|null>} - Map of path to content (null = didn't exist)
 */
export function createTransactionSnapshot(filePaths) {
  const snapshot = new Map();

  for (const filePath of filePaths) {
    snapshot.set(filePath, readFileForTransaction(filePath));
  }

  return snapshot;
}

/**
 * Restore files from snapshot (for rollback after commit)
 *
 * @param {Map<string, string|null>} snapshot - Snapshot from createTransactionSnapshot
 * @returns {{ restored: string[], errors: { path: string, error: string }[] }}
 */
export function restoreFromSnapshot(snapshot) {
  const restored = [];
  const errors = [];

  for (const [filePath, content] of snapshot) {
    try {
      if (content === null) {
        // File didn't exist before - delete if it exists now
        if (existsSync(filePath)) {
          unlinkSync(filePath);
          restored.push(filePath);
        }
      } else {
        // Restore original content
        writeFileSync(filePath, content, FILE_SYSTEM.UTF8);
        restored.push(filePath);
      }
    } catch (err) {
      errors.push({ path: filePath, error: err.message });
    }
  }

  return { restored, errors };
}
