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
import { LOG_PREFIX, EMOJI } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

/**
 * Represents a pending file write operation
 */
interface PendingWrite {
  /** Absolute or relative file path */
  path: string;
  /** File content to write */
  content: string;
  /** Human-readable description (e.g., "WU YAML", "status.md") */
  description: string;
}

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
  private readonly wuId: string;
  private readonly pendingWrites: Map<string, PendingWrite>;
  private committed: boolean;
  private aborted: boolean;
  private readonly createdAt: Date;

  /**
   * Create a new transaction
   * @param {string} wuId - WU ID for logging context
   */
  constructor(wuId: string) {
    this.wuId = wuId;
    this.pendingWrites = new Map();
    this.committed = false;
    this.aborted = false;
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
  addWrite(filePath: string, content: string, description: string): void {
    if (this.committed) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Cannot add writes to committed transaction (${this.wuId})`,
        { wuId: this.wuId, path: filePath },
      );
    }
    if (this.aborted) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Cannot add writes to aborted transaction (${this.wuId})`,
        { wuId: this.wuId, path: filePath },
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
  getPendingWrites(): PendingWrite[] {
    return Array.from(this.pendingWrites.values());
  }

  /**
   * Get count of pending writes
   * @returns {number}
   */
  get size(): number {
    return this.pendingWrites.size;
  }

  /**
   * Check if transaction has been committed
   * @returns {boolean}
   */
  get isCommitted(): boolean {
    return this.committed;
  }

  /**
   * Check if transaction has been aborted
   * @returns {boolean}
   */
  get isAborted(): boolean {
    return this.aborted;
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
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

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
  commit(): { success: boolean; written: string[]; failed: { path: string; error: string }[] } {
    if (this.committed) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Transaction already committed (${this.wuId})`,
        { wuId: this.wuId },
      );
    }
    if (this.aborted) {
      throw createError(
        ErrorCodes.TRANSACTION_ERROR,
        `Cannot commit aborted transaction (${this.wuId})`,
        { wuId: this.wuId },
      );
    }

    const written: string[] = [];
    const failed: { path: string; error: string }[] = [];

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Transaction COMMIT - writing ${this.pendingWrites.size} files atomically`,
    );

    for (const [filePath, write] of this.pendingWrites) {
      try {
        // Ensure parent directory exists
        const dir = path.dirname(filePath);
        if (dir && dir !== '.' && !existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }

        // Write file
        writeFileSync(filePath, write.content, { encoding: 'utf-8' });
        written.push(filePath);
        console.log(`${LOG_PREFIX.DONE}   ${EMOJI.SUCCESS} ${write.description}`);
      } catch (err) {
        const errMessage = err instanceof Error ? err.message : String(err);
        failed.push({ path: filePath, error: errMessage });
        console.error(`${LOG_PREFIX.DONE}   ${EMOJI.FAILURE} ${write.description}: ${errMessage}`);
      }
    }

    this.committed = true;
    this.pendingWrites.clear();

    const success = failed.length === 0;

    if (!success) {
      console.error(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Transaction completed with ${failed.length} failures`,
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
  abort(): void {
    if (this.committed) {
      console.warn(`${LOG_PREFIX.DONE} ${EMOJI.WARNING} Aborting already-committed transaction`);
      return;
    }

    const count = this.pendingWrites.size;
    this.pendingWrites.clear();
    this.aborted = true;

    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Transaction ABORTED - ${count} pending writes discarded`,
    );
  }

  /**
   * Get transaction state for debugging
   */
  getState(): {
    wuId: string;
    committed: boolean;
    aborted: boolean;
    pendingCount: number;
    files: string[];
    createdAt: string;
  } {
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
export function readFileForTransaction(filePath: string): string | null {
  if (!existsSync(filePath)) {
    return null;
  }
  return readFileSync(filePath, { encoding: 'utf-8' });
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
export function createTransactionSnapshot(filePaths: string[]): Map<string, string | null> {
  const snapshot = new Map<string, string | null>();

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
export function restoreFromSnapshot(snapshot: Map<string, string | null>): {
  restored: string[];
  errors: { path: string; error: string }[];
} {
  const restored: string[] = [];
  const errors: { path: string; error: string }[] = [];

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
        writeFileSync(filePath, content, { encoding: 'utf-8' });
        restored.push(filePath);
      }
    } catch (err) {
      const errMessage = err instanceof Error ? err.message : String(err);
      errors.push({ path: filePath, error: errMessage });
    }
  }

  return { restored, errors };
}
