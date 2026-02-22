// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU State Ports (WU-2013)
 *
 * Focused interfaces for the decomposed WU state store services.
 * Each interface defines a single responsibility boundary.
 *
 * @module ports/wu-state
 */

import type { WUEvent } from '../wu-state-schema.js';

/**
 * WU state entry in the in-memory store
 */
export interface WUStateEntry {
  status: string;
  lane: string;
  title: string;
  completedAt?: string;
  lastCheckpoint?: string;
  lastCheckpointNote?: string;
}

/**
 * Checkpoint options for recording WU progress
 */
export interface CheckpointOptions {
  sessionId?: string;
  progress?: string;
  nextSteps?: string;
}

/**
 * Lock file data structure
 */
export interface LockData {
  pid: number;
  timestamp: number;
  hostname: string;
}

/**
 * Repair result from corruption recovery
 */
export interface RepairResult {
  success: boolean;
  linesKept: number;
  linesRemoved: number;
  backupPath: string | null;
  warnings: string[];
}

/**
 * Event log interface for loading, replaying, and appending WU events.
 *
 * Responsible for:
 * - Loading events from JSONL storage
 * - Replaying events to rebuild in-memory state
 * - Appending new validated events
 * - Running delegation cutover migration
 */
export interface IWuEventLog {
  /**
   * Load and replay events from storage into in-memory state.
   * Resets all state before replaying.
   */
  load(): Promise<void>;

  /**
   * Append a validated event to persistent storage and apply to in-memory state.
   */
  appendAndApply(event: WUEvent): Promise<void>;

  /**
   * Apply a validated event to in-memory state without persisting.
   */
  applyEvent(event: WUEvent): void;
}

/**
 * Lock manager interface for file-level locking with stale detection.
 *
 * Responsible for:
 * - Acquiring file locks with retry logic
 * - Releasing file locks
 * - Detecting stale locks (expired or dead process)
 */
export interface IWuLockManager {
  /**
   * Acquire a file lock at the given path.
   * Retries with stale lock detection.
   *
   * @throws Error if lock cannot be acquired after retries
   */
  acquireLock(lockPath: string): Promise<void>;

  /**
   * Release a file lock at the given path.
   * Silently ignores errors if lock file doesn't exist.
   */
  releaseLock(lockPath: string): void;

  /**
   * Check if a lock is stale (expired timeout or dead process).
   */
  isLockStale(lockData: LockData): boolean;
}

/**
 * State query interface for O(1) lookups into WU state.
 *
 * Responsible for:
 * - Querying WU state by ID
 * - Querying WU IDs by status (O(1))
 * - Querying WU IDs by lane (O(1))
 * - Querying child WU IDs by parent (O(1))
 */
export interface IWuStateQuery {
  /**
   * Get current in-memory state for a WU.
   */
  getWUState(wuId: string): WUStateEntry | undefined;

  /**
   * Get WU IDs by status (O(1) lookup).
   */
  getByStatus(status: string): Set<string>;

  /**
   * Get WU IDs by lane (O(1) lookup).
   */
  getByLane(lane: string): Set<string>;

  /**
   * Get child WU IDs delegated from a parent WU (O(1) lookup).
   */
  getChildWUs(parentWuId: string): Set<string>;
}

// ---------------------------------------------------------------------------
// Composite interface for command handler injection (WU-2020)
// ---------------------------------------------------------------------------

/**
 * WU State Store interface for dependency injection in command handlers.
 *
 * Combines event log and state query capabilities into a single injectable
 * interface. Command handlers should depend on this interface rather than
 * importing and instantiating WUStateStore directly.
 *
 * WU-2020: DIP compliance - high-level modules depend on abstraction,
 * not on the concrete WUStateStore class.
 *
 * @example
 * ```typescript
 * // Command handler accepts interface, not concrete class
 * async function completeWU(store: IWuStateStore, wuId: string) {
 *   await store.load();
 *   await store.complete(wuId);
 * }
 * ```
 */
export interface IWuStateStore extends IWuEventLog, IWuStateQuery {
  /**
   * Claim a WU, transitioning it to in_progress status.
   * @throws Error if WU is already in_progress
   */
  claim(wuId: string, lane: string, title: string): Promise<void>;

  /**
   * Complete a WU, transitioning it to done status.
   * @throws Error if WU is not in_progress
   */
  complete(wuId: string): Promise<void>;

  /**
   * Block a WU with a reason.
   * @throws Error if WU is not in_progress
   */
  block(wuId: string, reason: string): Promise<void>;

  /**
   * Unblock a WU, transitioning it back to in_progress.
   * @throws Error if WU is not blocked
   */
  unblock(wuId: string): Promise<void>;

  /**
   * Record a checkpoint for a WU without changing its status.
   */
  checkpoint(wuId: string, note: string, options?: CheckpointOptions): Promise<void>;

  /**
   * Record a parent-child delegation relationship.
   */
  delegate(childWuId: string, parentWuId: string, delegationId: string): Promise<void>;

  /**
   * Release a WU, transitioning it from in_progress to ready.
   * @throws Error if WU is not in_progress
   */
  release(wuId: string, reason: string): Promise<void>;

  /**
   * Create a complete event without persisting it.
   * Useful for transactional flows.
   * @throws Error if WU is not in_progress
   */
  createCompleteEvent(wuId: string, timestamp?: string): WUEvent;

  /**
   * Create a release event without persisting it.
   * Useful for transactional flows.
   * @throws Error if WU is not in_progress
   */
  createReleaseEvent(wuId: string, reason: string, timestamp?: string): WUEvent;
}
