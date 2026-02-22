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
