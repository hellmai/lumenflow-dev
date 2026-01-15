/**
 * WU State Store (WU-1570, WU-2240)
 *
 * Event-sourced state store for WU lifecycle following INIT-007 pattern.
 * Stores events in .beacon/state/wu-events.jsonl (append-only, git-friendly).
 *
 * Features:
 * - Event sourcing with replay for current state
 * - Atomic append operations (WU-2240: temp file + fsync + rename)
 * - O(1) queries by status and lane via in-memory indexes
 * - State machine validation for legal transitions
 * - File locking with stale detection (WU-2240)
 * - Corruption recovery via repairStateFile (WU-2240)
 *
 * @see {@link tools/__tests__/state-store-concurrent.test.mjs} - Concurrent access tests
 * @see {@link tools/lib/wu-state-schema.mjs} - Schema definitions
 */

import fs from 'node:fs/promises';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  openSync,
  closeSync,
  fsyncSync,
} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateWUEvent } from './wu-state-schema.js';

/**
 * Lock timeout in milliseconds (5 minutes)
 * @type {number}
 */
const LOCK_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Lock retry configuration
 */
const LOCK_RETRY_DELAY_MS = 50;
const LOCK_MAX_RETRIES = 100; // 5 seconds total

/**
 * WU events file name constant
 */
export const WU_EVENTS_FILE_NAME = 'wu-events.jsonl';

/**
 * WU State Store class
 *
 * Manages WU lifecycle state via event sourcing pattern.
 * Events are appended to JSONL file, state is rebuilt by replaying events.
 */
export class WUStateStore {
  /**
   * @param {string} baseDir - Directory containing .beacon/state/
   */
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.eventsFilePath = path.join(baseDir, WU_EVENTS_FILE_NAME);

    // In-memory state (rebuilt from events)
    /** @type {Map<string, { status: string; lane: string; title: string }>} */
    this.wuState = new Map();

    /** @type {Map<string, Set<string>>} - Index: status -> Set<wuId> */
    this.byStatus = new Map();

    /** @type {Map<string, Set<string>>} - Index: lane -> Set<wuId> */
    this.byLane = new Map();

    /** @type {Map<string, Set<string>>} - Index: parentWuId -> Set<childWuId> (WU-1947) */
    this.byParent = new Map();
  }

  /**
   * Loads and replays events from JSONL file into current state.
   *
   * Handles:
   * - Missing file: returns empty state
   * - Empty file: returns empty state
   * - Empty lines: skipped gracefully
   * - Malformed JSON: throws error with line info
   * - Invalid events: throws validation error
   *
   * @returns {Promise<void>}
   * @throws {Error} If file contains malformed JSON or invalid events
   *
   * @example
   * const store = new WUStateStore('/path/to/project');
   * await store.load();
   * const inProgress = store.getByStatus('in_progress');
   */
  async load() {
    // Reset state
    this.wuState.clear();
    this.byStatus.clear();
    this.byLane.clear();
    this.byParent.clear();

    // Check if file exists
    let content;
    try {
      content = await fs.readFile(this.eventsFilePath, 'utf-8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - return empty state
        return;
      }
      throw error;
    }

    // Parse JSONL content
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) {
        continue;
      }

      // Parse JSON line
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw new Error(`Malformed JSON on line ${i + 1}: ${error.message}`);
      }

      // Validate against schema
      const validation = validateWUEvent(parsed);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
          .join(', ');
        throw new Error(`Validation error on line ${i + 1}: ${issues}`);
      }

      const event = validation.data;

      // Apply event to state
      this._applyEvent(event);
    }
  }

  /**
   * Transition WU to a new status if it exists.
   *
   * @private
   * @param {string} wuId - WU ID
   * @param {string} newStatus - New status to set
   */
  _transitionToStatus(wuId, newStatus) {
    const current = this.wuState.get(wuId);
    if (current) {
      this._setState(wuId, newStatus, current.lane, current.title);
    }
  }

  /**
   * Applies an event to the in-memory state.
   *
   * @private
   * @param {import('./wu-state-schema.js').WUEvent} event - Event to apply
   */
  _applyEvent(event) {
    const { wuId, type } = event;

    if (type === 'create' || type === 'claim') {
      this._setState(wuId, 'in_progress', event.lane, event.title);
      return;
    }

    if (type === 'block') {
      this._transitionToStatus(wuId, 'blocked');
      return;
    }

    if (type === 'unblock') {
      this._transitionToStatus(wuId, 'in_progress');
      return;
    }

    if (type === 'complete') {
      this._transitionToStatus(wuId, 'done');
      // WU-2244: Store completion timestamp for accurate date reporting
      const current = this.wuState.get(wuId);
      if (current) {
        current.completedAt = event.timestamp;
      }
      return;
    }

    if (type === 'checkpoint') {
      const currentCheckpoint = this.wuState.get(wuId);
      if (currentCheckpoint) {
        currentCheckpoint.lastCheckpoint = event.timestamp;
        currentCheckpoint.lastCheckpointNote = event.note;
      }
      return;
    }

    if (type === 'spawn') {
      const { parentWuId } = event;
      if (!this.byParent.has(parentWuId)) {
        this.byParent.set(parentWuId, new Set());
      }
      this.byParent.get(parentWuId).add(wuId);
    }
  }

  /**
   * Sets WU state and updates indexes.
   *
   * @private
   * @param {string} wuId - WU ID
   * @param {string} status - New status
   * @param {string} lane - Lane name
   * @param {string} title - WU title
   */
  _setState(wuId, status, lane, title) {
    // Remove from old status index
    const oldState = this.wuState.get(wuId);
    if (oldState) {
      const oldStatusSet = this.byStatus.get(oldState.status);
      if (oldStatusSet) {
        oldStatusSet.delete(wuId);
      }

      // Remove from old lane index
      const oldLaneSet = this.byLane.get(oldState.lane);
      if (oldLaneSet) {
        oldLaneSet.delete(wuId);
      }
    }

    // Update state
    this.wuState.set(wuId, { status, lane, title });

    // Add to new status index
    if (!this.byStatus.has(status)) {
      this.byStatus.set(status, new Set());
    }
    this.byStatus.get(status).add(wuId);

    // Add to new lane index
    if (!this.byLane.has(lane)) {
      this.byLane.set(lane, new Set());
    }
    this.byLane.get(lane).add(wuId);
  }

  /**
   * Appends an event to the events file.
   *
   * Uses append mode to avoid full file rewrite.
   * Creates file and parent directories if they don't exist.
   * Validates event before appending.
   *
   * @private
   * @param {import('./wu-state-schema.js').WUEvent} event - Event to append
   * @returns {Promise<void>}
   * @throws {Error} If event fails validation
   */
  async _appendEvent(event) {
    // Validate event before appending
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }

    const line = `${JSON.stringify(event)}\n`;

    // WU-1740: Ensure parent directory exists before appending
    // fs.appendFile creates the file but not parent directories
    await fs.mkdir(this.baseDir, { recursive: true });

    // Use append flag to avoid rewriting the file
    await fs.appendFile(this.eventsFilePath, line, 'utf-8');
  }

  /**
   * Claims a WU (transitions to in_progress).
   *
   * @param {string} wuId - WU ID
   * @param {string} lane - Lane name
   * @param {string} title - WU title
   * @returns {Promise<void>}
   * @throws {Error} If WU is already in_progress
   *
   * @example
   * await store.claim('WU-1570', 'Operations: Tooling', 'Test WU');
   */
  async claim(wuId, lane, title) {
    // Check state machine: can't claim if already in_progress
    const currentState = this.wuState.get(wuId);
    if (currentState && currentState.status === 'in_progress') {
      throw new Error(`WU ${wuId} is already in_progress`);
    }

    const event = {
      type: 'claim',
      wuId,
      lane,
      title,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Completes a WU (transitions to done).
   *
   * @param {string} wuId - WU ID
   * @returns {Promise<void>}
   * @throws {Error} If WU is not in_progress
   *
   * @example
   * await store.complete('WU-1570');
   */
  async complete(wuId) {
    // Check state machine: can only complete if in_progress
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== 'in_progress') {
      throw new Error(`WU ${wuId} is not in_progress`);
    }

    const event = {
      type: 'complete',
      wuId,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Get current in-memory state for a WU.
   *
   * @param {string} wuId - WU ID
   * @returns {{ status: string; lane: string; title: string } | undefined}
   */
  getWUState(wuId) {
    return this.wuState.get(wuId);
  }

  /**
   * Create a complete event without writing to disk.
   *
   * Used by transactional flows where event log writes are staged and committed atomically.
   *
   * @param {string} wuId - WU ID
   * @param {string} [timestamp] - ISO-8601 timestamp override
   * @returns {import('./wu-state-schema.js').WUEvent}
   * @throws {Error} If WU is not in_progress or event fails validation
   */
  createCompleteEvent(wuId, timestamp = new Date().toISOString()) {
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== 'in_progress') {
      throw new Error(`WU ${wuId} is not in_progress`);
    }

    const event = { type: 'complete', wuId, timestamp };
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }
    return validation.data;
  }

  /**
   * Apply a validated event to in-memory state without writing to disk.
   *
   * @param {import('./wu-state-schema.js').WUEvent} event - Event to apply
   * @returns {void}
   * @throws {Error} If event fails validation
   */
  applyEvent(event) {
    const validation = validateWUEvent(event);
    if (!validation.success) {
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      throw new Error(`Validation error: ${issues}`);
    }
    this._applyEvent(validation.data);
  }

  /**
   * Blocks a WU (transitions to blocked).
   *
   * @param {string} wuId - WU ID
   * @param {string} reason - Blocking reason
   * @returns {Promise<void>}
   * @throws {Error} If WU is not in_progress
   *
   * @example
   * await store.block('WU-1570', 'Blocked by dependency');
   */
  async block(wuId, reason) {
    // Check state machine: can only block if in_progress
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== 'in_progress') {
      throw new Error(`WU ${wuId} is not in_progress`);
    }

    const event = {
      type: 'block',
      wuId,
      reason,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Unblocks a WU (transitions back to in_progress).
   *
   * @param {string} wuId - WU ID
   * @returns {Promise<void>}
   * @throws {Error} If WU is not blocked
   *
   * @example
   * await store.unblock('WU-1570');
   */
  async unblock(wuId) {
    // Check state machine: can only unblock if blocked
    const currentState = this.wuState.get(wuId);
    if (!currentState || currentState.status !== 'blocked') {
      throw new Error(`WU ${wuId} is not blocked`);
    }

    const event = {
      type: 'unblock',
      wuId,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Records a checkpoint for a WU (WU-1748: cross-agent visibility).
   *
   * Checkpoints are recorded for visibility but don't change WU state.
   * Used to track progress and detect abandoned WUs.
   *
   * @param {string} wuId - WU ID
   * @param {string} note - Checkpoint note/description
   * @param {object} [options] - Optional fields
   * @param {string} [options.sessionId] - Session ID
   * @param {string} [options.progress] - Progress summary
   * @param {string} [options.nextSteps] - Next steps description
   * @returns {Promise<void>}
   *
   * @example
   * await store.checkpoint('WU-1748', 'Completed worktree scanner', {
   *   progress: 'Scanner implemented and tests passing',
   *   nextSteps: 'Integrate into orchestrate:status'
   * });
   */
  async checkpoint(wuId, note, options = {}) {
    const { sessionId, progress, nextSteps } = options;

    const event = {
      type: 'checkpoint',
      wuId,
      note,
      timestamp: new Date().toISOString(),
    };

    if (sessionId) event.sessionId = sessionId;
    if (progress) event.progress = progress;
    if (nextSteps) event.nextSteps = nextSteps;

    await this._appendEvent(event);
    this._applyEvent(event);
  }

  /**
   * Gets WU IDs by status (O(1) lookup).
   *
   * @param {string} status - Status to query (ready, in_progress, blocked, waiting, done)
   * @returns {Set<string>} Set of WU IDs with this status
   *
   * @example
   * const inProgress = store.getByStatus('in_progress');
   * for (const wuId of inProgress) {
   *   console.log(wuId);
   * }
   */
  getByStatus(status) {
    return this.byStatus.get(status) ?? new Set();
  }

  /**
   * Gets WU IDs by lane (O(1) lookup).
   *
   * @param {string} lane - Lane name to query
   * @returns {Set<string>} Set of WU IDs in this lane
   *
   * @example
   * const tooling = store.getByLane('Operations: Tooling');
   * for (const wuId of tooling) {
   *   console.log(wuId);
   * }
   */
  getByLane(lane) {
    return this.byLane.get(lane) ?? new Set();
  }

  /**
   * Gets child WU IDs spawned from a parent WU (O(1) lookup).
   * WU-1947: Parent-child relationship tracking.
   *
   * @param {string} parentWuId - Parent WU ID to query
   * @returns {Set<string>} Set of child WU IDs spawned from this parent
   *
   * @example
   * const children = store.getChildWUs('WU-100');
   * for (const childId of children) {
   *   console.log(`Child WU: ${childId}`);
   * }
   */
  getChildWUs(parentWuId) {
    return this.byParent.get(parentWuId) ?? new Set();
  }

  /**
   * Records a spawn relationship between parent and child WUs.
   * WU-1947: Parent-child relationship tracking.
   *
   * @param {string} childWuId - Child WU ID being spawned
   * @param {string} parentWuId - Parent WU ID spawning the child
   * @param {string} spawnId - Unique spawn identifier
   * @returns {Promise<void>}
   *
   * @example
   * await store.spawn('WU-200', 'WU-100', 'spawn-abc123');
   */
  async spawn(childWuId, parentWuId, spawnId) {
    const event = {
      type: 'spawn',
      wuId: childWuId,
      parentWuId,
      spawnId,
      timestamp: new Date().toISOString(),
    };

    await this._appendEvent(event);
    this._applyEvent(event);
  }
}

/**
 * Check if a process with given PID is running
 *
 * @param {number} pid - Process ID to check
 * @returns {boolean} True if process is running
 */
function isProcessRunning(pid) {
  try {
    // Sending signal 0 checks if process exists without affecting it
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a lock is stale (expired or dead process)
 *
 * WU-2240: Prepared for proper-lockfile integration
 *
 * @param {object} lockData - Lock file data
 * @param {number} lockData.pid - Process ID that holds the lock
 * @param {number} lockData.timestamp - Lock acquisition timestamp
 * @param {string} lockData.hostname - Hostname of lock holder
 * @returns {boolean} True if lock is stale
 */
export function isLockStale(lockData) {
  const now = Date.now();
  const lockAge = now - lockData.timestamp;

  // Check timeout first (5 minutes)
  if (lockAge > LOCK_TIMEOUT_MS) {
    return true;
  }

  // Check if on same host - if different host, can't check PID
  if (lockData.hostname !== os.hostname()) {
    // Different host, only rely on timeout
    return false;
  }

  // Same host - check if process is still alive
  return !isProcessRunning(lockData.pid);
}

/**
 * Safely remove a lock file, ignoring errors
 * @param {string} lockPath - Path to lock file
 */
function safeUnlink(lockPath) {
  try {
    unlinkSync(lockPath);
  } catch {
    // Ignore removal errors
  }
}

/**
 * Read and parse existing lock file
 * @param {string} lockPath - Path to lock file
 * @returns {object|null} Lock data or null if corrupted
 */
function readLockFile(lockPath) {
  try {
    const content = readFileSync(lockPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Handle existing lock file - returns true if should retry
 * @param {string} lockPath - Path to lock file
 * @returns {Promise<boolean>} True if should retry loop
 */
async function handleExistingLock(lockPath) {
  const existingLock = readLockFile(lockPath);
  if (!existingLock) {
    // Corrupted lock file - remove and retry
    safeUnlink(lockPath);
    return true;
  }

  if (isLockStale(existingLock)) {
    safeUnlink(lockPath);
    return true;
  }

  // Lock is held by active process - wait and retry
  await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
  return true;
}

/**
 * Try to create a lock file atomically
 * @param {string} lockPath - Path to lock file
 * @param {object} lockData - Lock data to write
 * @returns {Promise<boolean>} True if lock acquired
 */
async function tryCreateLock(lockPath, lockData) {
  try {
    mkdirSync(path.dirname(lockPath), { recursive: true });
    const fd = openSync(lockPath, 'wx');
    const content = JSON.stringify(lockData);
    writeFileSync(fd, content, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);
    return true;
  } catch (error) {
    if (error.code === 'EEXIST') {
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_DELAY_MS));
      return false;
    }
    throw error;
  }
}

/**
 * Acquire a file lock for the events file
 *
 * Uses a JSON lock file containing PID, timestamp, and hostname.
 * Implements stale lock detection via:
 * - PID check (on same host)
 * - 5-minute timeout (across hosts)
 *
 * WU-2240: Prepared for proper-lockfile integration
 *
 * @param {string} lockPath - Path to lock file
 * @returns {Promise<void>}
 * @throws {Error} If lock cannot be acquired after retries
 */
export async function acquireLock(lockPath) {
  const lockData = {
    pid: process.pid,
    timestamp: Date.now(),
    hostname: os.hostname(),
  };

  for (let attempt = 0; attempt < LOCK_MAX_RETRIES; attempt++) {
    if (existsSync(lockPath)) {
      const shouldRetry = await handleExistingLock(lockPath);
      if (shouldRetry) continue;
    }

    const acquired = await tryCreateLock(lockPath, lockData);
    if (acquired) return;
  }

  throw new Error(`Failed to acquire lock after ${LOCK_MAX_RETRIES} attempts`);
}

/**
 * Release a file lock
 *
 * WU-2240: Prepared for proper-lockfile integration
 *
 * @param {string} lockPath - Path to lock file
 */
export function releaseLock(lockPath) {
  safeUnlink(lockPath);
}

/**
 * Repair a corrupted state file by removing invalid lines.
 *
 * WU-2240: Corruption recovery for wu-events.jsonl
 *
 * Features:
 * - Creates backup before repair
 * - Removes malformed JSON lines
 * - Removes lines that fail schema validation
 * - Returns detailed repair statistics
 *
 * @param {string} filePath - Path to the state file to repair
 * @returns {Promise<{success: boolean, linesKept: number, linesRemoved: number, backupPath: string, warnings: string[]}>}
 *
 * @example
 * const stateFilePath = path.join(process.cwd(), '.beacon', 'state', 'wu-events.jsonl');
 * const result = await repairStateFile(stateFilePath);
 * if (result.success) {
 *   console.log(`Repaired: kept ${result.linesKept}, removed ${result.linesRemoved}`);
 * }
 */
export async function repairStateFile(filePath) {
  const warnings = [];
  let linesKept = 0;
  let linesRemoved = 0;

  // Check if file exists
  if (!existsSync(filePath)) {
    return {
      success: true,
      linesKept: 0,
      linesRemoved: 0,
      backupPath: null,
      warnings: ['File does not exist, nothing to repair'],
    };
  }

  // Read the original content
  const originalContent = readFileSync(filePath, 'utf-8');
  const lines = originalContent.split('\n');

  // Create backup with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${filePath}.backup.${timestamp}`;
  writeFileSync(backupPath, originalContent, 'utf-8');

  // Process each line
  const validLines = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Skip empty lines
    if (!line) {
      continue;
    }

    // Try to parse JSON
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      linesRemoved++;
      warnings.push(`Line ${i + 1}: Malformed JSON removed`);
      continue;
    }

    // Validate against schema
    const validation = validateWUEvent(parsed);
    if (!validation.success) {
      linesRemoved++;
      const issues = validation.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join(', ');
      warnings.push(`Line ${i + 1}: Invalid event removed (${issues})`);
      continue;
    }

    // Line is valid
    validLines.push(line);
    linesKept++;
  }

  // Write repaired file atomically
  const tempPath = `${filePath}.tmp.${process.pid}`;
  const repairedContent = validLines.length > 0 ? `${validLines.join('\n')}\n` : '';

  try {
    const fd = openSync(tempPath, 'w');
    writeFileSync(fd, repairedContent, 'utf-8');
    fsyncSync(fd);
    closeSync(fd);

    // Atomic rename
    renameSync(tempPath, filePath);

    // Fsync directory
    const dirPath = path.dirname(filePath);
    const dirFd = openSync(dirPath, 'r');
    fsyncSync(dirFd);
    closeSync(dirFd);
  } catch (error) {
    // Cleanup temp file on failure
    try {
      unlinkSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }

  // Add warning if file is now empty
  if (linesKept === 0 && linesRemoved > 0) {
    warnings.push('All lines were invalid - file is now empty');
  }

  return {
    success: true,
    linesKept,
    linesRemoved,
    backupPath,
    warnings,
  };
}
