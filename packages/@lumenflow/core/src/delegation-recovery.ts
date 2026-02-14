/**
 * Spawn Recovery Module (WU-1951)
 *
 * Auto-recovery heuristics for stuck spawns and zombie locks.
 * Used by orchestrate:monitor for automatic spawn health management.
 *
 * Recovery Heuristics:
 * 1. Zombie lock (PID not running) -> auto-release, mark spawn crashed
 * 2. Stale lock (>2h) -> auto-release, mark spawn timeout
 * 3. Active lock + no checkpoint in 1h -> mark stuck, escalate
 *
 * All recovery actions are logged to .lumenflow/recovery/ for audit.
 *
 * Library-First Note: This is project-specific spawn recovery code for
 * ExampleApp's custom spawn-registry.jsonl, lane-lock, and memory-store.
 * No external library exists for this domain-specific agent lifecycle management.
 *
 * @see {@link packages/@lumenflow/cli/src/lib/__tests__/delegation-recovery.test.ts} - Tests
 * @see {@link packages/@lumenflow/cli/src/lib/delegation-monitor.ts} - Monitoring logic
 * @see {@link packages/@lumenflow/cli/src/lib/delegation-registry-store.ts} - Spawn state
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { DelegationRegistryStore } from './delegation-registry-store.js';
import { DelegationStatus } from './delegation-registry-schema.js';
import {
  isZombieLock,
  isLockStale,
  readLockMetadata,
  getLockFilePath,
  releaseLaneLock,
} from './lane-lock.js';
import { toKebab, LUMENFLOW_PATHS } from './wu-constants.js';

// Optional import from @lumenflow/memory
let loadMemory:
  | ((
      baseDir: string,
      wuId: string,
    ) => Promise<{ checkpoints: Array<{ timestamp: string }> } | null>)
  | null = null;
try {
  const mod = await import('@lumenflow/memory/store');
  loadMemory = mod.loadMemory;
} catch {
  // @lumenflow/memory not available - memory features disabled
}

/**
 * Recovery action constants
 */
export const RecoveryAction = Object.freeze({
  /** No recovery needed */
  NONE: 'none',
  /** Zombie lock released (PID not running) */
  RELEASED_ZOMBIE: 'released_zombie',
  /** Stale lock released (>2h old) */
  RELEASED_STALE: 'released_stale',
  /** Stuck spawn escalated (active but no checkpoint in 1h) */
  ESCALATED_STUCK: 'escalated_stuck',
});

/**
 * Recovery directory name
 */
export const RECOVERY_DIR_NAME = 'recovery';

/**
 * Threshold for "no checkpoint" detection (1 hour in milliseconds)
 */
export const NO_CHECKPOINT_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * Log prefix for delegation-recovery messages
 */
const LOG_PREFIX = '[delegation-recovery]';

/**
 * @typedef {Object} RecoveryResult
 * @property {boolean} recovered - Whether a recovery action was taken
 * @property {string} action - The recovery action taken (from RecoveryAction)
 * @property {string} reason - Human-readable explanation of the result
 */

/**
 * @typedef {Object} AuditLogEntry
 * @property {string} timestamp - ISO timestamp of recovery action
 * @property {string} delegationId - ID of the spawn being recovered
 * @property {string} action - Recovery action taken
 * @property {string} reason - Explanation of why action was taken
 * @property {Object} context - Additional context
 * @property {string} context.targetWuId - Target WU ID
 * @property {string} context.lane - Lane name
 * @property {Object|null} context.lockMetadata - Lock metadata if present
 * @property {string|null} context.lastCheckpoint - Last checkpoint timestamp
 */

/**
 * Converts lane name to lock file path (kebab-case)
 *
 * @param {string} lane - Lane name (e.g., "Operations: Tooling")
 * @returns {string} Kebab-case lane name (e.g., "operations-tooling")
 */
function laneToKebab(lane) {
  return toKebab(lane);
}

/**
 * Gets the recovery directory path
 *
 * @param {string} baseDir - Base directory
 * @returns {string} Path to .lumenflow/recovery/
 */
function getRecoveryDir(baseDir) {
  return path.join(baseDir, LUMENFLOW_PATHS.BASE, RECOVERY_DIR_NAME);
}

/**
 * Creates an audit log entry
 *
 * @param {string} baseDir - Base directory
 * @param {AuditLogEntry} entry - Audit log entry
 * @returns {Promise<void>}
 */
async function createAuditLog(baseDir, entry) {
  const recoveryDir = getRecoveryDir(baseDir);
  await fs.mkdir(recoveryDir, { recursive: true });

  const timestamp = entry.timestamp.replace(/[:.]/g, '-');
  const fileName = `${entry.delegationId}-${timestamp}.json`;
  const filePath = path.join(recoveryDir, fileName);

  await fs.writeFile(filePath, JSON.stringify(entry, null, 2), 'utf-8');
  console.log(`${LOG_PREFIX} Audit log created: ${fileName}`);
}

/**
 * Gets the most recent checkpoint for a WU from the memory store
 *
 * @param {string} baseDir - Base directory
 * @param {string} wuId - WU ID to find checkpoints for
 * @returns {Promise<{timestamp: string, content: string}|null>} Most recent checkpoint or null
 */
async function getLastCheckpoint(
  baseDir: string,
  wuId: string,
): Promise<{ timestamp: string; content: string } | null> {
  // If memory module not available, return null
  if (!loadMemory) {
    return null;
  }

  const memoryDir = path.join(baseDir, LUMENFLOW_PATHS.STATE_DIR);

  try {
    const memory = await loadMemory(memoryDir, wuId);
    if (!memory) {
      return null;
    }

    const checkpoints = memory.checkpoints ?? [];

    if (checkpoints.length === 0) {
      return null;
    }

    // Sort by timestamp descending, get most recent
    checkpoints.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    const latest = checkpoints[0];
    return {
      timestamp: latest.timestamp,
      content: '',
    };
  } catch {
    // Memory store doesn't exist or is invalid
    return null;
  }
}

/**
 * Checks if a checkpoint is recent enough (within 1 hour)
 *
 * @param {string|null} checkpointTimestamp - ISO timestamp of last checkpoint
 * @returns {boolean} True if checkpoint is recent (within 1 hour)
 */
function isCheckpointRecent(checkpointTimestamp) {
  if (!checkpointTimestamp) {
    return false;
  }

  const checkpointTime = new Date(checkpointTimestamp).getTime();
  const now = Date.now();
  return now - checkpointTime <= NO_CHECKPOINT_THRESHOLD_MS;
}

/**
 * Recovers a stuck spawn by applying appropriate heuristics.
 *
 * Recovery order (first match wins):
 * 1. Zombie lock (PID not running) -> release lock, mark crashed
 * 2. Stale lock (>2h) -> release lock, mark timeout
 * 3. Active lock + no checkpoint in 1h -> escalate (no auto-release)
 * 4. Healthy spawn -> no action
 *
 * @param {string} delegationId - ID of the spawn to recover
 * @param {RecoverStuckDelegationOptions} options - Options
 * @returns {Promise<RecoveryResult>} Recovery result
 *
 * @example
 * const result = await recoverStuckDelegation('spawn-1234', { baseDir: '/path/to/project' });
 * if (result.recovered) {
 *   console.log(`Recovered: ${result.action} - ${result.reason}`);
 * }
 */
export interface RecoverStuckDelegationOptions {
  /** Base directory for .lumenflow/ */
  baseDir?: string;
}

export async function recoverStuckDelegation(delegationId, options: RecoverStuckDelegationOptions = {}) {
  const { baseDir = process.cwd() } = options;
  const registryDir = path.join(baseDir, LUMENFLOW_PATHS.STATE_DIR);

  // Load spawn registry
  const store = new DelegationRegistryStore(registryDir);

  try {
    await store.load();
  } catch {
    // Registry doesn't exist or is invalid
    return {
      recovered: false,
      action: RecoveryAction.NONE,
      reason: `Spawn ${delegationId} not found: registry unavailable`,
    };
  }

  // Find the spawn
  const spawn = store.getById(delegationId);

  if (!spawn) {
    return {
      recovered: false,
      action: RecoveryAction.NONE,
      reason: `Spawn ${delegationId} not found in registry`,
    };
  }

  // Check if already completed
  if (spawn.status !== DelegationStatus.PENDING) {
    return {
      recovered: false,
      action: RecoveryAction.NONE,
      reason: `Spawn ${delegationId} already ${spawn.status}`,
    };
  }

  // Get lock for this spawn's lane
  const _laneKebab = laneToKebab(spawn.lane);
  const lockPath = getLockFilePath(spawn.lane, baseDir);
  const lockMetadata = readLockMetadata(lockPath);

  // If no lock, nothing to recover
  if (!lockMetadata) {
    return {
      recovered: false,
      action: RecoveryAction.NONE,
      reason: `No lock found for spawn ${delegationId} (lane: ${spawn.lane})`,
    };
  }

  // Check if lock belongs to this WU
  if (lockMetadata.wuId !== spawn.targetWuId) {
    return {
      recovered: false,
      action: RecoveryAction.NONE,
      reason: `Lock belongs to ${lockMetadata.wuId}, not spawn target ${spawn.targetWuId}`,
    };
  }

  // Get last checkpoint for context
  const lastCheckpoint = await getLastCheckpoint(baseDir, spawn.targetWuId);
  const lastCheckpointTs = lastCheckpoint?.timestamp ?? null;

  // Build common audit context
  const auditContext = {
    targetWuId: spawn.targetWuId,
    parentWuId: spawn.parentWuId,
    lane: spawn.lane,
    delegatedAt: spawn.delegatedAt,
    lockMetadata,
    lastCheckpoint: lastCheckpointTs,
  };

  // Heuristic 1: Zombie lock (PID not running)
  if (isZombieLock(lockMetadata)) {
    console.log(
      `${LOG_PREFIX} Detected zombie lock for ${delegationId} (PID ${lockMetadata.pid} not running)`,
    );

    // Release the lock
    releaseLaneLock(spawn.lane, { baseDir, force: true });

    // Mark spawn as crashed
    await store.updateStatus(delegationId, DelegationStatus.CRASHED);

    const reason = `Zombie lock detected: PID ${lockMetadata.pid} not running`;

    // Create audit log
    await createAuditLog(baseDir, {
      timestamp: new Date().toISOString(),
      delegationId,
      action: RecoveryAction.RELEASED_ZOMBIE,
      reason,
      context: auditContext,
    });

    return {
      recovered: true,
      action: RecoveryAction.RELEASED_ZOMBIE,
      reason,
    };
  }

  // Heuristic 2: Stale lock (>2h old)
  if (isLockStale(lockMetadata)) {
    console.log(
      `${LOG_PREFIX} Detected stale lock for ${delegationId} (acquired ${lockMetadata.timestamp})`,
    );

    // Release the lock
    releaseLaneLock(spawn.lane, { baseDir, force: true });

    // Mark spawn as timeout
    await store.updateStatus(delegationId, DelegationStatus.TIMEOUT);

    const reason = `Stale lock detected: acquired ${lockMetadata.timestamp} (>2h threshold)`;

    // Create audit log
    await createAuditLog(baseDir, {
      timestamp: new Date().toISOString(),
      delegationId,
      action: RecoveryAction.RELEASED_STALE,
      reason,
      context: auditContext,
    });

    return {
      recovered: true,
      action: RecoveryAction.RELEASED_STALE,
      reason,
    };
  }

  // Heuristic 3: Active lock + no recent checkpoint -> escalate
  if (!isCheckpointRecent(lastCheckpointTs)) {
    const reason = lastCheckpointTs
      ? `No checkpoint in last hour (last: ${lastCheckpointTs})`
      : 'No checkpoints recorded for this spawn';

    console.log(`${LOG_PREFIX} Escalating stuck spawn ${delegationId}: ${reason}`);

    // Create audit log (escalation, not recovery)
    await createAuditLog(baseDir, {
      timestamp: new Date().toISOString(),
      delegationId,
      action: RecoveryAction.ESCALATED_STUCK,
      reason,
      context: auditContext,
    });

    return {
      recovered: false, // No auto-recovery, just escalation
      action: RecoveryAction.ESCALATED_STUCK,
      reason: `Stuck spawn: ${reason}`,
    };
  }

  // Healthy spawn with recent checkpoint
  return {
    recovered: false,
    action: RecoveryAction.NONE,
    reason: `Spawn ${delegationId} healthy (recent checkpoint at ${lastCheckpointTs})`,
  };
}
