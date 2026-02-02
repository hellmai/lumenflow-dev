#!/usr/bin/env node
/**
 * Lane Lock Module
 *
 * Provides atomic file-based locking to prevent TOCTOU (Time Of Check To Time Of Use)
 * race conditions when multiple agents try to claim WUs in the same lane simultaneously.
 *
 * The lock file is created atomically using the 'wx' flag (exclusive create),
 * which fails if the file already exists. This prevents the race condition where
 * parallel agents could both read status.md before either updates it.
 *
 * Lock file location: .lumenflow/locks/<lane-kebab>.lock
 * Lock file format: JSON with wuId, timestamp, agentSession, pid
 *
 * Lock policy support (WU-1323):
 * - 'all' (default): Lock held through entire WU lifecycle
 * - 'active': Lock released on block, re-acquired on unblock (CLI behavior)
 * - 'none': No lock files created, WIP checking disabled for the lane
 *
 * @see WU-1603 - Race condition fix for wu:claim
 * @see WU-1323 - Lock policy integration tests
 */

import {
  openSync,
  closeSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
  existsSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { toKebab, LUMENFLOW_PATHS, getProjectRoot } from './wu-constants.js';
// WU-1325: Import lock policy getter
import { getLockPolicyForLane } from './lane-checker.js';

// Type definitions (exported for declaration generation)
export interface LockMetadata {
  wuId: string;
  timestamp: string;
  agentSession: string | null;
  pid: number;
  lane: string;
}

interface LockResult {
  acquired: boolean;
  error: string | null;
  existingLock: LockMetadata | null;
  isStale: boolean;
  /** WU-1325: True if lock acquisition was skipped due to lock_policy=none */
  skipped?: boolean;
}

interface UnlockResult {
  released: boolean;
  error: string | null;
  notFound: boolean;
}

interface AuditedUnlockResult extends UnlockResult {
  reason?: string;
  forced?: boolean;
  previousLock?: LockMetadata | null;
}

interface AcquireLockOptions {
  agentSession?: string | null;
  baseDir?: string | null;
}

interface ReleaseLockOptions {
  wuId?: string | null;
  baseDir?: string | null;
  force?: boolean;
}

interface CheckLockOptions {
  baseDir?: string | null;
}

interface AuditedUnlockOptions {
  reason: string;
  baseDir?: string | null;
  force?: boolean;
}

/** Log prefix for lane-lock messages */
const LOG_PREFIX = '[lane-lock]';

/** Directory for lock files relative to project root */
const LOCKS_DIR = LUMENFLOW_PATHS.LOCKS_DIR;

/** Default stale lock threshold in hours (WU-1949: reduced from 24h to 2h) */
const DEFAULT_STALE_LOCK_THRESHOLD_HOURS = 2;

/**
 * Get the stale lock threshold in milliseconds.
 *
 * WU-1949: Default is 2 hours. Can be overridden via STALE_LOCK_THRESHOLD_HOURS env var.
 *
 * @returns {number} Threshold in milliseconds
 */
export function getStaleThresholdMs(): number {
  const envValue = process.env.STALE_LOCK_THRESHOLD_HOURS;
  if (envValue) {
    const hours = parseFloat(envValue);
    if (!Number.isNaN(hours) && hours > 0) {
      return hours * 60 * 60 * 1000;
    }
  }
  return DEFAULT_STALE_LOCK_THRESHOLD_HOURS * 60 * 60 * 1000;
}

/**
 * @typedef {Object} LockMetadata
 * @property {string} wuId - WU ID that holds the lock (e.g., "WU-123")
 * @property {string} timestamp - ISO timestamp when lock was acquired
 * @property {string|null} agentSession - Agent session ID if available
 * @property {number} pid - Process ID that acquired the lock
 * @property {string} lane - Original lane name
 */

/**
 * @typedef {Object} LockResult
 * @property {boolean} acquired - Whether lock was successfully acquired
 * @property {string|null} error - Error message if acquisition failed
 * @property {LockMetadata|null} existingLock - Existing lock metadata if lock already exists
 * @property {boolean} isStale - Whether the existing lock is stale (>2h old by default)
 */

/**
 * @typedef {Object} UnlockResult
 * @property {boolean} released - Whether lock was successfully released
 * @property {string|null} error - Error message if release failed
 * @property {boolean} notFound - Whether lock file was not found
 */

/**
 * Get the path to the locks directory
 * @param {string} [baseDir] - Optional base directory (defaults to project root)
 * @returns {string} Absolute path to locks directory
 */
export function getLocksDir(baseDir: string | null = null): string {
  const projectRoot = baseDir || getProjectRoot(import.meta.url);
  return path.join(projectRoot, LOCKS_DIR);
}

/**
 * Get the path to a lock file for a specific lane
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @param {string} [baseDir] - Optional base directory
 * @returns {string} Absolute path to lock file
 */
export function getLockFilePath(lane: string, baseDir: string | null = null): string {
  const laneKebab = toKebab(lane);
  const locksDir = getLocksDir(baseDir);
  return path.join(locksDir, `${laneKebab}.lock`);
}

/**
 * Ensure the locks directory exists
 * @param {string} [baseDir] - Optional base directory
 */
function ensureLocksDir(baseDir: string | null = null): void {
  const locksDir = getLocksDir(baseDir);
  if (!existsSync(locksDir)) {
    mkdirSync(locksDir, { recursive: true });
  }
}

/**
 * Check if a lock is stale (>2 hours old by default, configurable via env var)
 *
 * WU-1949: Reduced threshold from 24h to 2h. Zombie detection (PID check)
 * remains the fast-path for immediate recovery when process has exited.
 *
 * @param {LockMetadata} metadata - Lock metadata
 * @returns {boolean} True if lock is stale
 */
export function isLockStale(metadata: LockMetadata | null): boolean {
  if (!metadata || !metadata.timestamp) {
    return true; // Invalid metadata is considered stale
  }

  const lockTime = new Date(metadata.timestamp).getTime();
  const now = Date.now();
  return now - lockTime > getStaleThresholdMs();
}

/**
 * WU-1808: Check if a lock is a "zombie" (PID no longer running)
 *
 * A zombie lock occurs when the process that acquired the lock has crashed
 * or exited without releasing it. This function checks if the process
 * identified by the lock's PID is still running.
 *
 * @param {LockMetadata} metadata - Lock metadata
 * @returns {boolean} True if lock is a zombie (PID not running)
 */
export function isZombieLock(metadata: LockMetadata | null): boolean {
  if (!metadata || typeof metadata.pid !== 'number') {
    return true; // Invalid metadata is considered zombie
  }

  // Check if process is running by sending signal 0
  // This doesn't actually send a signal, but checks if the process exists
  try {
    process.kill(metadata.pid, 0);
    return false; // Process exists
  } catch {
    // ESRCH = no such process (zombie)
    // EPERM = process exists but we don't have permission (not zombie)
    return true;
  }
}

/**
 * Read lock metadata from a lock file
 * @param {string} lockPath - Path to lock file
 * @returns {LockMetadata|null} Lock metadata or null if file doesn't exist/is invalid
 */
export function readLockMetadata(lockPath: string): LockMetadata | null {
  try {
    if (!existsSync(lockPath)) {
      return null;
    }
    const content = readFileSync(lockPath, { encoding: 'utf-8' });
    return JSON.parse(content) as LockMetadata;
  } catch {
    // Invalid JSON or read error - treat as no lock
    return null;
  }
}

/**
 * Acquire a lane lock atomically
 *
 * Uses the 'wx' flag for atomic file creation - fails if file already exists.
 * This prevents TOCTOU race conditions where multiple agents could both
 * read an empty lock state before either writes.
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @param {string} wuId - WU ID being claimed (e.g., "WU-123")
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.agentSession] - Agent session ID
 * @param {string} [options.baseDir] - Base directory for lock files
 * @returns {LockResult} Result of lock acquisition attempt
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- WU-1808: Added zombie lock detection increases complexity but all paths are necessary
export function acquireLaneLock(
  lane: string,
  wuId: string,
  options: AcquireLockOptions = {},
): LockResult {
  const { agentSession = null, baseDir = null } = options;

  // WU-1325: Check lock policy before acquiring
  const lockPolicy = getLockPolicyForLane(lane);
  if (lockPolicy === 'none') {
    // eslint-disable-next-line no-console -- CLI tool status message
    console.log(`${LOG_PREFIX} Skipping lock acquisition for "${lane}" (lock_policy=none)`);
    return {
      acquired: true,
      error: null,
      existingLock: null,
      isStale: false,
      skipped: true,
    };
  }

  try {
    ensureLocksDir(baseDir);
    const lockPath = getLockFilePath(lane, baseDir);

    // Build lock metadata
    const metadata = {
      wuId,
      timestamp: new Date().toISOString(),
      agentSession,
      pid: process.pid,
      lane,
    };

    try {
      // Attempt atomic file creation with 'wx' flag
      // 'wx' = write exclusive - fails if file exists
      const fd = openSync(lockPath, 'wx');

      // Write metadata and close
      writeFileSync(lockPath, JSON.stringify(metadata, null, 2), { encoding: 'utf-8' });
      closeSync(fd);

      console.log(`${LOG_PREFIX} Acquired lane lock for "${lane}" (${wuId})`);
      return {
        acquired: true,
        error: null,
        existingLock: null,
        isStale: false,
      };
    } catch (err) {
      // File already exists - check if it's our lock or another agent's
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
        const existingLock = readLockMetadata(lockPath);
        const stale = existingLock ? isLockStale(existingLock) : true;
        const zombie = existingLock ? isZombieLock(existingLock) : true;

        // Check if it's the same WU (re-claim attempt)
        if (existingLock && existingLock.wuId === wuId) {
          console.log(`${LOG_PREFIX} Lock already held by same WU (${wuId})`);
          return {
            acquired: true, // Allow re-claim of same WU
            error: null,
            existingLock,
            isStale: stale,
          };
        }

        // WU-1808: Auto-clear zombie locks (PID no longer running)
        // This allows recovery from crashed wu:claim processes
        if (zombie) {
          console.warn(
            `${LOG_PREFIX} Detected zombie lock for "${lane}" (PID ${existingLock?.pid} not running)`,
          );
          console.warn(`${LOG_PREFIX}    Previous owner: ${existingLock?.wuId}`);
          console.warn(`${LOG_PREFIX}    Lock timestamp: ${existingLock?.timestamp}`);
          console.warn(`${LOG_PREFIX}    Auto-clearing zombie lock...`);

          // Remove the zombie lock
          try {
            unlinkSync(lockPath);
          } catch {
            // Ignore errors - file might have been removed by another process
          }

          // Retry acquisition
          return acquireLaneLock(lane, wuId, options);
        }

        return {
          acquired: false,
          error: existingLock
            ? `Lane "${lane}" is locked by ${existingLock.wuId} (since ${existingLock.timestamp})`
            : `Lane "${lane}" has an invalid lock file`,
          existingLock,
          isStale: stale,
        };
      }

      // Other error (permissions, etc.)
      throw err;
    }
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    return {
      acquired: false,
      error: `Failed to acquire lane lock: ${errMessage}`,
      existingLock: null,
      isStale: false,
    };
  }
}

/**
 * Release a lane lock
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.wuId] - WU ID to validate ownership (optional)
 * @param {string} [options.baseDir] - Base directory for lock files
 * @param {boolean} [options.force] - Force release even if not owner
 * @returns {UnlockResult} Result of lock release attempt
 */
export function releaseLaneLock(lane: string, options: ReleaseLockOptions = {}): UnlockResult {
  const { wuId = null, baseDir = null, force = false } = options;

  try {
    const lockPath = getLockFilePath(lane, baseDir);

    if (!existsSync(lockPath)) {
      // Lock doesn't exist - not an error, just nothing to release
      return {
        released: true,
        error: null,
        notFound: true,
      };
    }

    // Validate ownership if wuId provided
    if (wuId && !force) {
      const existingLock = readLockMetadata(lockPath);
      if (existingLock && existingLock.wuId !== wuId) {
        return {
          released: false,
          error: `Cannot release lock: owned by ${existingLock.wuId}, not ${wuId}`,
          notFound: false,
        };
      }
    }

    // Remove the lock file
    unlinkSync(lockPath);
    console.log(`${LOG_PREFIX} Released lane lock for "${lane}"`);

    return {
      released: true,
      error: null,
      notFound: false,
    };
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    return {
      released: false,
      error: `Failed to release lane lock: ${errMessage}`,
      notFound: false,
    };
  }
}

/**
 * Check if a lane is currently locked
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.baseDir] - Base directory for lock files
 * @returns {{ locked: boolean, metadata: LockMetadata|null, isStale: boolean }}
 */
export function checkLaneLock(
  lane: string,
  options: CheckLockOptions = {},
): { locked: boolean; metadata: LockMetadata | null; isStale: boolean } {
  const { baseDir = null } = options;

  const lockPath = getLockFilePath(lane, baseDir);
  const metadata = readLockMetadata(lockPath);

  if (!metadata) {
    return {
      locked: false,
      metadata: null,
      isStale: false,
    };
  }

  return {
    locked: true,
    metadata,
    isStale: isLockStale(metadata),
  };
}

/**
 * Force-remove a stale lock with warning
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.baseDir] - Base directory for lock files
 * @returns {UnlockResult} Result of forced removal
 */
export function forceRemoveStaleLock(lane: string, options: CheckLockOptions = {}): UnlockResult {
  const { baseDir = null } = options;

  const lockPath = getLockFilePath(lane, baseDir);
  const existingLock = readLockMetadata(lockPath);

  if (!existingLock) {
    return {
      released: true,
      error: null,
      notFound: true,
    };
  }

  if (!isLockStale(existingLock)) {
    return {
      released: false,
      error: `Cannot force-remove: lock is not stale (${existingLock.wuId} since ${existingLock.timestamp})`,
      notFound: false,
    };
  }

  console.warn(`${LOG_PREFIX} ⚠️  Force-removing stale lock for "${lane}"`);
  console.warn(`${LOG_PREFIX}    Previous owner: ${existingLock.wuId}`);
  console.warn(`${LOG_PREFIX}    Lock timestamp: ${existingLock.timestamp}`);

  return releaseLaneLock(lane, { baseDir, force: true });
}

/**
 * Get all current lane locks
 *
 * @param {Object} [options] - Optional parameters
 * @param {string} [options.baseDir] - Base directory for lock files
 * @returns {Map<string, LockMetadata>} Map of lane name to lock metadata
 */
export function getAllLaneLocks(options: CheckLockOptions = {}): Map<string, LockMetadata> {
  const { baseDir = null } = options;
  const locksDir = getLocksDir(baseDir);
  const locks = new Map<string, LockMetadata>();

  if (!existsSync(locksDir)) {
    return locks;
  }

  try {
    const files = require('node:fs').readdirSync(locksDir);
    for (const file of files) {
      if (!file.endsWith('.lock')) continue;

      const lockPath = path.join(locksDir, file);
      const metadata = readLockMetadata(lockPath);

      if (metadata && metadata.lane) {
        locks.set(metadata.lane, metadata);
      }
    }
  } catch {
    // Ignore errors reading directory
  }

  return locks;
}

/**
 * @typedef {Object} AuditedUnlockResult
 * @property {boolean} released - Whether lock was successfully released
 * @property {string|null} error - Error message if release failed
 * @property {boolean} notFound - Whether lock file was not found
 * @property {string} [reason] - The provided reason for unlocking
 * @property {boolean} [forced] - Whether --force was used
 * @property {LockMetadata|null} [previousLock] - Metadata of the removed lock
 */

/**
 * WU-1808: Audited unlock command for operators to safely clear lane locks
 *
 * This function provides a dedicated command for operators to clear locks with
 * proper audit logging. It follows a safety-first approach:
 *
 * - Zombie locks (PID not running): Can be unlocked without --force
 * - Stale locks (>2h old by default): Can be unlocked without --force
 * - Active locks (recent, PID running): Require --force to unlock
 *
 * All unlocks require a reason parameter for audit purposes.
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @param {Object} options - Required options
 * @param {string} options.reason - Reason for unlocking (required for audit)
 * @param {string} [options.baseDir] - Base directory for lock files
 * @param {boolean} [options.force] - Force unlock even if lock is active
 * @returns {AuditedUnlockResult} Result of audited unlock attempt
 */
export function auditedUnlock(lane: string, options: AuditedUnlockOptions): AuditedUnlockResult {
  const { reason, baseDir = null, force = false } = options;

  // Require reason for audit trail
  if (!reason) {
    return {
      released: false,
      error: 'Reason is required for audited unlock. Use --reason "<text>"',
      notFound: false,
    };
  }

  const lockPath = getLockFilePath(lane, baseDir);
  const existingLock = readLockMetadata(lockPath);

  // Handle non-existent lock
  if (!existingLock) {
    return {
      released: true,
      error: null,
      notFound: true,
      reason,
    };
  }

  const stale = isLockStale(existingLock);
  const zombie = isZombieLock(existingLock);
  const safeToRemove = stale || zombie;

  // If lock is active (not stale, not zombie), require --force
  if (!safeToRemove && !force) {
    return {
      released: false,
      error:
        `Cannot unlock active lock for "${lane}" (${existingLock.wuId}).\n` +
        `Lock is recent (${existingLock.timestamp}) and PID ${existingLock.pid} is running.\n` +
        `Use --force to override (emergency only).`,
      notFound: false,
      previousLock: existingLock,
    };
  }

  // Log the unlock for audit purposes
  const unlockType = force ? 'FORCED' : zombie ? 'ZOMBIE' : 'STALE';
  console.log(`${LOG_PREFIX} Audited unlock (${unlockType}) for "${lane}"`);
  console.log(`${LOG_PREFIX}    Previous owner: ${existingLock.wuId}`);
  console.log(`${LOG_PREFIX}    Lock timestamp: ${existingLock.timestamp}`);
  console.log(`${LOG_PREFIX}    Lock PID: ${existingLock.pid}`);
  console.log(`${LOG_PREFIX}    Reason: ${reason}`);
  if (force && !safeToRemove) {
    console.warn(`${LOG_PREFIX}    ⚠️  WARNING: Forced unlock of active lock!`);
  }

  // Release the lock
  const releaseResult = releaseLaneLock(lane, { baseDir, force: true });

  return {
    ...releaseResult,
    reason,
    forced: force && !safeToRemove,
    previousLock: existingLock,
  };
}
