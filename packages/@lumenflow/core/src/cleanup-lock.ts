// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2241: Cleanup Lock Module
 * WU-1174: Lock files moved to temp directory to avoid polluting main checkout
 *
 * Provides atomic locking mechanism for wu:done cleanup operations
 * to prevent race conditions during concurrent worktree/branch cleanup.
 *
 * Features:
 * - File-based lock with PID, timestamp, and worktree path
 * - Stale lock detection and auto-cleanup (5-minute threshold)
 * - Zombie lock detection (PID not running)
 * - Idempotent re-acquisition for same WU
 * - Guaranteed cleanup via withCleanupLock wrapper
 * - Lock files stored in temp directory (not main checkout)
 *
 * Lock ordering (WU-2241):
 *   Lane lock (phase-scoped) -> Merge lock -> Cleanup lock -> State store lock
 *
 * Pattern: Follows lane-lock.ts and merge-lock.ts internal patterns.
 *
 * @module cleanup-lock
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
  openSync,
  closeSync,
} from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LOG_PREFIX, EMOJI, LUMENFLOW_PATHS, LOCK_DIR_NAME } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';
import {
  LOCK_TIMEOUT_MS,
  CLEANUP_LOCK_STALE_MS as CLEANUP_STALE_MS,
  LOCK_POLL_INTERVAL_MS,
} from './constants/lock-constants.js';

/** Cleanup lock file info */
interface CleanupLockInfo {
  wuId: string;
  lockId: string;
  createdAt: string;
  pid: number;
  hostname: string;
  worktreePath?: string | null;
}

/**
 * Default timeout for waiting to acquire lock (ms)
 * After this time, acquisition fails if lock is held
 */
export const CLEANUP_LOCK_TIMEOUT_MS = LOCK_TIMEOUT_MS;

/**
 * Time after which a cleanup lock is considered stale (ms)
 * Should be greater than expected cleanup operation duration
 * Cleanup is slower than merge, so longer timeout
 */
export const CLEANUP_LOCK_STALE_MS = CLEANUP_STALE_MS;

/** Lock file name within .lumenflow directory */
const LOCK_FILE_NAME = 'cleanup.lock';

/**
 * @typedef {Object} CleanupLockInfo
 * @property {string} wuId - WU ID that holds the lock
 * @property {string} lockId - Unique lock identifier
 * @property {string} createdAt - ISO timestamp when lock was created
 * @property {number} pid - Process ID of lock holder
 * @property {string} hostname - Hostname of lock holder
 * @property {string} [worktreePath] - Path to worktree being cleaned up
 */

/**
 * @typedef {Object} CleanupAcquireResult
 * @property {boolean} acquired - Whether lock was acquired
 * @property {string} [lockId] - Lock ID if acquired
 * @property {string} [heldBy] - WU ID holding the lock if not acquired
 * @property {string} [heldSince] - ISO timestamp if not acquired
 */

/**
 * Options for lock file operations
 */
interface BaseDirOptions {
  /**
   * Base directory override (for testing only)
   *
   * WU-1174: In production, locks are always stored in LUMENFLOW_PATHS.LOCK_DIR
   * (a temp directory). This option allows tests to use isolated directories.
   */
  baseDir?: string;
}

/**
 * Get the path to the cleanup lock file
 *
 * WU-1174: Lock files are stored in a temp directory to avoid polluting
 * the main checkout. The baseDir option is only for testing isolation.
 *
 * @param {BaseDirOptions} [options]
 * @returns {string} Path to lock file
 */
function getLockPath(options: BaseDirOptions = {}) {
  // WU-1174: Use temp directory for locks (not main checkout's .lumenflow/)
  // baseDir is only used for test isolation
  const lockDir = options.baseDir
    ? path.join(options.baseDir, LOCK_DIR_NAME)
    : LUMENFLOW_PATHS.LOCK_DIR;
  return path.join(lockDir, LOCK_FILE_NAME);
}

/**
 * Read lock file contents
 *
 * @param {BaseDirOptions} [options]
 * @returns {CleanupLockInfo|null} Lock info or null if no lock
 */
function readLockFile(options: BaseDirOptions = {}) {
  const lockPath = getLockPath(options);
  if (!existsSync(lockPath)) {
    return null;
  }
  try {
    const content = readFileSync(lockPath, 'utf8');
    return JSON.parse(content);
  } catch {
    // Corrupted lock file - treat as no lock
    return null;
  }
}

/**
 * Delete lock file
 *
 * @param {BaseDirOptions} [options]
 */
function deleteLockFile(options: BaseDirOptions = {}) {
  const lockPath = getLockPath(options);
  if (existsSync(lockPath)) {
    unlinkSync(lockPath);
  }
}

/**
 * Check if a lock is stale (older than CLEANUP_LOCK_STALE_MS)
 *
 * @param {CleanupLockInfo} lockInfo - Lock info to check
 * @returns {boolean} True if lock is stale
 */
export function isCleanupLockStale(lockInfo: CleanupLockInfo | null) {
  if (!lockInfo || !lockInfo.createdAt) {
    return true;
  }
  const lockTime = new Date(lockInfo.createdAt).getTime();
  const age = Date.now() - lockTime;
  return age > CLEANUP_LOCK_STALE_MS;
}

/**
 * Check if a lock is a zombie (PID not running)
 *
 * @param {CleanupLockInfo} lockInfo - Lock info to check
 * @returns {boolean} True if lock is a zombie (PID not running)
 */
export function isCleanupLockZombie(lockInfo: CleanupLockInfo | null) {
  if (!lockInfo || typeof lockInfo.pid !== 'number') {
    return true;
  }

  try {
    process.kill(lockInfo.pid, 0); // Signal 0 = check existence
    return false; // Process exists
  } catch {
    return true; // Process doesn't exist
  }
}

/**
 * Generate a unique lock ID
 *
 * @returns {string} Unique lock ID
 */
function generateLockId() {
  return crypto.randomUUID();
}

/**
 * Sleep for specified milliseconds
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if cleanup lock is currently held
 *
 * @param {BaseDirOptions} [options]
 * @returns {boolean} True if lock is held (and not stale)
 */
export function isCleanupLocked(options: BaseDirOptions = {}) {
  const lockInfo = readLockFile(options);
  if (!lockInfo) {
    return false;
  }
  // Stale or zombie locks are treated as unlocked
  return !isCleanupLockStale(lockInfo) && !isCleanupLockZombie(lockInfo);
}

/**
 * Get information about current cleanup lock
 *
 * @param {BaseDirOptions} [options]
 * @returns {CleanupLockInfo|null} Lock info or null if unlocked
 */
export function getCleanupLockInfo(options: BaseDirOptions = {}) {
  const lockInfo = readLockFile(options);
  if (!lockInfo || isCleanupLockStale(lockInfo) || isCleanupLockZombie(lockInfo)) {
    return null;
  }
  return lockInfo;
}

/**
 * Attempt atomic lock file creation
 * Returns 'acquired' | 'race' | throws on other errors
 *
 * @param {CleanupLockInfo} lockInfo - Lock info to write
 * @param {Object} options - Options with baseDir
 * @returns {'acquired' | 'race'} Result of acquisition attempt
 */
function tryAtomicLockCreate(
  lockInfo: CleanupLockInfo,
  options: BaseDirOptions,
): 'acquired' | 'race' {
  const lockPath = getLockPath(options);
  const lockDir = path.dirname(lockPath);
  // WU-1174: Ensure lock directory exists (temp directory, not .lumenflow/)
  if (!existsSync(lockDir)) {
    mkdirSync(lockDir, { recursive: true });
  }

  try {
    // Use 'wx' flag for atomic creation
    const fd = openSync(lockPath, 'wx');
    writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2));
    closeSync(fd);
    return 'acquired';
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EEXIST') {
      return 'race';
    }
    throw err;
  }
}

/**
 * Handle stale or zombie lock cleanup
 * Returns 'retry' if lock was cleaned, null if lock is valid
 *
 * @param {CleanupLockInfo} existingLock - Existing lock info
 * @param {Object} options - Options with baseDir
 * @returns {'retry' | null} Whether to retry acquisition
 */
function handleStaleLock(existingLock: CleanupLockInfo, options: BaseDirOptions): 'retry' | null {
  if (isCleanupLockStale(existingLock)) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cleaning up stale cleanup lock from ${existingLock.wuId}`,
    );
    deleteLockFile(options);
    return 'retry';
  }

  if (isCleanupLockZombie(existingLock)) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cleaning up zombie cleanup lock from ${existingLock.wuId} (PID ${existingLock.pid} not running)`,
    );
    deleteLockFile(options);
    return 'retry';
  }

  return null;
}

/**
 * Options for acquiring cleanup lock
 */
export interface AcquireCleanupLockOptions extends BaseDirOptions {
  /** Max time to wait for lock (default: CLEANUP_LOCK_TIMEOUT_MS) */
  waitMs?: number;
  /** Path to worktree being cleaned up */
  worktreePath?: string | null;
}

/**
 * Attempt to acquire the cleanup lock
 *
 * Will wait up to waitMs for lock to become available.
 * If the same WU already holds the lock, re-acquisition succeeds (idempotent).
 * Stale and zombie locks are automatically cleaned up.
 *
 * @param {string} wuId - WU ID requesting the lock
 * @param {AcquireCleanupLockOptions} [options]
 * @returns {Promise<CleanupAcquireResult>} Acquisition result
 */
export async function acquireCleanupLock(wuId: string, options: AcquireCleanupLockOptions = {}) {
  const { baseDir, waitMs = CLEANUP_LOCK_TIMEOUT_MS, worktreePath = null } = options;
  const startTime = Date.now();

  while (true) {
    const existingLock = readLockFile({ baseDir });

    // No lock exists - acquire it
    if (!existingLock) {
      const lockId = generateLockId();
      const lockInfo = {
        wuId,
        lockId,
        createdAt: new Date().toISOString(),
        pid: process.pid,
        hostname: process.env.HOSTNAME || 'unknown',
        worktreePath,
      };

      const result = tryAtomicLockCreate(lockInfo, { baseDir });
      if (result === 'race') {
        continue; // Race condition - retry
      }

      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Acquired cleanup lock for ${wuId}`);
      return { acquired: true, lockId };
    }

    // Check for stale/zombie locks
    if (handleStaleLock(existingLock, { baseDir }) === 'retry') {
      continue;
    }

    // Same WU already holds lock - return existing lock ID (idempotent)
    if (existingLock.wuId === wuId) {
      return { acquired: true, lockId: existingLock.lockId };
    }

    // Different WU holds lock - check if we should wait
    const elapsed = Date.now() - startTime;
    if (elapsed >= waitMs) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cleanup lock held by ${existingLock.wuId} since ${existingLock.createdAt}`,
      );
      return {
        acquired: false,
        heldBy: existingLock.wuId,
        heldSince: existingLock.createdAt,
      };
    }

    // Wait and retry
    await sleep(LOCK_POLL_INTERVAL_MS);
  }
}

/**
 * Release the cleanup lock
 *
 * Only releases if the provided lockId matches the current lock.
 * This prevents accidentally releasing another WU's lock.
 *
 * @param {string} lockId - Lock ID to release
 * @param {BaseDirOptions} [options]
 * @returns {boolean} True if lock was released
 */
export function releaseCleanupLock(lockId: string, options: BaseDirOptions = {}) {
  const existingLock = readLockFile(options);

  if (!existingLock) {
    return false;
  }

  if (existingLock.lockId !== lockId) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cannot release cleanup lock - lockId mismatch`,
    );
    return false;
  }

  deleteLockFile(options);
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Released cleanup lock for ${existingLock.wuId}`);

  return true;
}

/**
 * Execute a function while holding the cleanup lock
 *
 * Guarantees the lock is released after function completes,
 * even if the function throws an error.
 *
 * @template T
 * @param {string} wuId - WU ID requesting the lock
 * @param {function(): Promise<T>} fn - Async function to execute
 * @param {AcquireCleanupLockOptions} [options]
 * @returns {Promise<T>} Result of function execution
 * @throws {Error} If lock cannot be acquired or function throws
 */
export async function withCleanupLock<T>(
  wuId: string,
  fn: () => Promise<T>,
  options: AcquireCleanupLockOptions = {},
): Promise<T> {
  const result = await acquireCleanupLock(wuId, options);

  if (!result.acquired) {
    throw createError(
      ErrorCodes.LOCK_ERROR,
      `Cannot acquire cleanup lock - held by ${result.heldBy} since ${result.heldSince}`,
      { wuId, heldBy: result.heldBy, heldSince: result.heldSince },
    );
  }

  try {
    return await fn();
  } finally {
    releaseCleanupLock(result.lockId, options);
  }
}
