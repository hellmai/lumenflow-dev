/**
 * WU-2241: Cleanup Lock Module
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
 *
 * Lock ordering (WU-2241):
 *   Lane lock (phase-scoped) -> Merge lock -> Cleanup lock -> State store lock
 *
 * Pattern: Follows lane-lock.mjs and merge-lock.mjs internal patterns.
 *
 * @module cleanup-lock
 */

/* eslint-disable security/detect-non-literal-fs-filename -- Lock file paths are computed from trusted sources */
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
import { LOG_PREFIX, EMOJI } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

/**
 * Default timeout for waiting to acquire lock (ms)
 * After this time, acquisition fails if lock is held
 */
export const CLEANUP_LOCK_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Time after which a cleanup lock is considered stale (ms)
 * Should be greater than expected cleanup operation duration
 * Cleanup is slower than merge, so longer timeout
 */
export const CLEANUP_LOCK_STALE_MS = 5 * 60 * 1000; // 5 minutes

/** Lock file name within .beacon directory */
const LOCK_FILE_NAME = 'cleanup.lock';

/**
 * Polling interval for lock acquisition retries
 */
const LOCK_POLL_INTERVAL_MS = 500;

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
 * Get the path to the cleanup lock file
 *
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory (defaults to cwd)
 * @returns {string} Path to lock file
 */
function getLockPath(options = {}) {
  const baseDir = options.baseDir || process.cwd();
  return path.join(baseDir, '.beacon', LOCK_FILE_NAME);
}

/**
 * Read lock file contents
 *
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @returns {CleanupLockInfo|null} Lock info or null if no lock
 */
function readLockFile(options = {}) {
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
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 */
function deleteLockFile(options = {}) {
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
export function isCleanupLockStale(lockInfo) {
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
export function isCleanupLockZombie(lockInfo) {
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if cleanup lock is currently held
 *
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @returns {boolean} True if lock is held (and not stale)
 */
export function isCleanupLocked(options = {}) {
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
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @returns {CleanupLockInfo|null} Lock info or null if unlocked
 */
export function getCleanupLockInfo(options = {}) {
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
function tryAtomicLockCreate(lockInfo, options) {
  const lockPath = getLockPath(options);
  const beaconDir = path.dirname(lockPath);
  if (!existsSync(beaconDir)) {
    mkdirSync(beaconDir, { recursive: true });
  }

  try {
    // Use 'wx' flag for atomic creation
    const fd = openSync(lockPath, 'wx');
    writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2));
    closeSync(fd);
    return 'acquired';
  } catch (err) {
    if (err.code === 'EEXIST') {
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
function handleStaleLock(existingLock, options) {
  if (isCleanupLockStale(existingLock)) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cleaning up stale cleanup lock from ${existingLock.wuId}`
    );
    deleteLockFile(options);
    return 'retry';
  }

  if (isCleanupLockZombie(existingLock)) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cleaning up zombie cleanup lock from ${existingLock.wuId} (PID ${existingLock.pid} not running)`
    );
    deleteLockFile(options);
    return 'retry';
  }

  return null;
}

/**
 * Attempt to acquire the cleanup lock
 *
 * Will wait up to waitMs for lock to become available.
 * If the same WU already holds the lock, re-acquisition succeeds (idempotent).
 * Stale and zombie locks are automatically cleaned up.
 *
 * @param {string} wuId - WU ID requesting the lock
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @param {number} [options.waitMs] - Max time to wait for lock (default: CLEANUP_LOCK_TIMEOUT_MS)
 * @param {string} [options.worktreePath] - Path to worktree being cleaned up
 * @returns {Promise<CleanupAcquireResult>} Acquisition result
 */
export async function acquireCleanupLock(wuId, options = {}) {
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
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cleanup lock held by ${existingLock.wuId} since ${existingLock.createdAt}`
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
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @returns {boolean} True if lock was released
 */
export function releaseCleanupLock(lockId, options = {}) {
  const existingLock = readLockFile(options);

  if (!existingLock) {
    return false;
  }

  if (existingLock.lockId !== lockId) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cannot release cleanup lock - lockId mismatch`
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
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @param {number} [options.waitMs] - Max time to wait for lock
 * @param {string} [options.worktreePath] - Path to worktree being cleaned up
 * @returns {Promise<T>} Result of function execution
 * @throws {Error} If lock cannot be acquired or function throws
 */
export async function withCleanupLock(wuId, fn, options = {}) {
  const result = await acquireCleanupLock(wuId, options);

  if (!result.acquired) {
    throw createError(
      ErrorCodes.LOCK_ERROR,
      `Cannot acquire cleanup lock - held by ${result.heldBy} since ${result.heldSince}`,
      { wuId, heldBy: result.heldBy, heldSince: result.heldSince }
    );
  }

  try {
    return await fn();
  } finally {
    releaseCleanupLock(result.lockId, options);
  }
}
