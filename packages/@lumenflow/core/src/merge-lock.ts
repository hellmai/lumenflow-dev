/**
 * WU-1747: Merge Lock Module
 *
 * Provides atomic locking mechanism for wu:done merge operations
 * to prevent race conditions during concurrent completions.
 *
 * Features:
 * - File-based lock with PID and timestamp
 * - Stale lock detection and auto-cleanup
 * - Idempotent re-acquisition for same WU
 * - Guaranteed cleanup via withMergeLock wrapper
 *
 * @module merge-lock
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LOG_PREFIX, EMOJI } from './wu-constants.js';
import { createError, ErrorCodes } from './error-handler.js';

/**
 * Default timeout for waiting to acquire lock (ms)
 * After this time, acquisition fails if lock is held
 */
export const MERGE_LOCK_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Time after which a lock is considered stale and can be forcibly released (ms)
 * Should be greater than expected merge operation duration
 */
export const MERGE_LOCK_STALE_MS = 60000; // 60 seconds

/** Lock file name within .beacon directory */
const LOCK_FILE_NAME = 'merge.lock';

/**
 * Polling interval for lock acquisition retries
 */
const LOCK_POLL_INTERVAL_MS = 500;

/**
 * @typedef {Object} LockInfo
 * @property {string} wuId - WU ID that holds the lock
 * @property {string} lockId - Unique lock identifier
 * @property {string} createdAt - ISO timestamp when lock was created
 * @property {number} pid - Process ID of lock holder
 * @property {string} hostname - Hostname of lock holder
 */

/**
 * @typedef {Object} AcquireResult
 * @property {boolean} acquired - Whether lock was acquired
 * @property {string} [lockId] - Lock ID if acquired
 * @property {string} [heldBy] - WU ID holding the lock if not acquired
 * @property {string} [heldSince] - ISO timestamp if not acquired
 */

/**
 * Get the path to the merge lock file
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
 * @returns {LockInfo|null} Lock info or null if no lock
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
 * Write lock file
 *
 * @param {LockInfo} lockInfo - Lock information to write
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 */
function writeLockFile(lockInfo, options = {}) {
  const lockPath = getLockPath(options);
  const beaconDir = path.dirname(lockPath);

  // Ensure .beacon directory exists
  if (!existsSync(beaconDir)) {
    mkdirSync(beaconDir, { recursive: true });
  }

  writeFileSync(lockPath, JSON.stringify(lockInfo, null, 2));
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
 * Check if a lock is stale (older than MERGE_LOCK_STALE_MS)
 *
 * @param {LockInfo} lockInfo - Lock info to check
 * @returns {boolean} True if lock is stale
 */
function isLockStale(lockInfo) {
  if (!lockInfo || !lockInfo.createdAt) {
    return true;
  }
  const lockTime = new Date(lockInfo.createdAt).getTime();
  const age = Date.now() - lockTime;
  return age > MERGE_LOCK_STALE_MS;
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
 * Check if merge lock is currently held
 *
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @returns {boolean} True if lock is held (and not stale)
 */
export function isMergeLocked(options = {}) {
  const lockInfo = readLockFile(options);
  if (!lockInfo) {
    return false;
  }
  // Stale locks are treated as unlocked
  return !isLockStale(lockInfo);
}

/**
 * Get information about current merge lock
 *
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @returns {LockInfo|null} Lock info or null if unlocked
 */
export function getMergeLockInfo(options = {}) {
  const lockInfo = readLockFile(options);
  if (!lockInfo || isLockStale(lockInfo)) {
    return null;
  }
  return lockInfo;
}

/**
 * Attempt to acquire the merge lock
 *
 * Will wait up to waitMs for lock to become available.
 * If the same WU already holds the lock, re-acquisition succeeds (idempotent).
 * Stale locks are automatically cleaned up.
 *
 * @param {string} wuId - WU ID requesting the lock
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @param {number} [options.waitMs] - Max time to wait for lock (default: MERGE_LOCK_TIMEOUT_MS)
 * @returns {Promise<AcquireResult>} Acquisition result
 */
export async function acquireMergeLock(wuId, options = {}) {
  const { baseDir, waitMs = MERGE_LOCK_TIMEOUT_MS } = options;
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
      };

      writeLockFile(lockInfo, { baseDir });
      console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Acquired merge lock for ${wuId}`);

      return { acquired: true, lockId };
    }

    // Lock is stale - clean it up and acquire
    if (isLockStale(existingLock)) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cleaning up stale lock from ${existingLock.wuId}`
      );
      deleteLockFile({ baseDir });
      continue; // Retry acquisition
    }

    // Same WU already holds lock - return existing lock ID (idempotent)
    if (existingLock.wuId === wuId) {
      return { acquired: true, lockId: existingLock.lockId };
    }

    // Different WU holds lock - check if we should wait
    const elapsed = Date.now() - startTime;
    if (elapsed >= waitMs) {
      console.log(
        `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Merge lock held by ${existingLock.wuId} since ${existingLock.createdAt}`
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
 * Release the merge lock
 *
 * Only releases if the provided lockId matches the current lock.
 * This prevents accidentally releasing another WU's lock.
 *
 * @param {string} lockId - Lock ID to release
 * @param {Object} [options]
 * @param {string} [options.baseDir] - Base directory
 * @returns {boolean} True if lock was released
 */
export function releaseMergeLock(lockId, options = {}) {
  const existingLock = readLockFile(options);

  if (!existingLock) {
    return false;
  }

  if (existingLock.lockId !== lockId) {
    console.log(
      `${LOG_PREFIX.DONE} ${EMOJI.WARNING} Cannot release lock - lockId mismatch`
    );
    return false;
  }

  deleteLockFile(options);
  console.log(`${LOG_PREFIX.DONE} ${EMOJI.SUCCESS} Released merge lock for ${existingLock.wuId}`);

  return true;
}

/**
 * Execute a function while holding the merge lock
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
 * @returns {Promise<T>} Result of function execution
 * @throws {Error} If lock cannot be acquired or function throws
 */
export async function withMergeLock(wuId, fn, options = {}) {
  const result = await acquireMergeLock(wuId, options);

  if (!result.acquired) {
    throw createError(
      ErrorCodes.LOCK_ERROR,
      `Cannot acquire merge lock - held by ${result.heldBy} since ${result.heldSince}`,
      { wuId, heldBy: result.heldBy, heldSince: result.heldSince }
    );
  }

  try {
    return await fn();
  } finally {
    releaseMergeLock(result.lockId, options);
  }
}
