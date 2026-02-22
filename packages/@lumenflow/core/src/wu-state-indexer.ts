// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU State Indexer (WU-2013)
 *
 * Manages in-memory WU state and maintains O(1) indexes by status, lane,
 * and parent-child delegation relationships. Applies events to state
 * following the INIT-007 event-sourcing pattern.
 *
 * Single responsibility: in-memory state management and event application.
 *
 * @see {@link ./wu-state-store.ts} - Facade that delegates to this service
 */

import { WU_STATUS } from './wu-constants.js';
import type { WUEvent } from './wu-state-schema.js';

/**
 * Delegation event type constant (matches DELEGATION_CUTOVER.RELATIONSHIP_EVENT_TYPE)
 */
const DELEGATION_EVENT_TYPE = 'delegation';

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
 * Checkpoint options
 */
export interface CheckpointOptions {
  sessionId?: string;
  progress?: string;
  nextSteps?: string;
}

/**
 * WU State Indexer
 *
 * Maintains in-memory WU state with O(1) indexes for status, lane,
 * and parent-child queries. Processes events to update state.
 */
export class WUStateIndexer {
  private wuState: Map<string, WUStateEntry>;
  private byStatus: Map<string, Set<string>>;
  private byLane: Map<string, Set<string>>;
  private byParent: Map<string, Set<string>>;

  constructor() {
    this.wuState = new Map();
    this.byStatus = new Map();
    this.byLane = new Map();
    this.byParent = new Map();
  }

  /**
   * Clear all in-memory state and indexes.
   */
  clear(): void {
    this.wuState.clear();
    this.byStatus.clear();
    this.byLane.clear();
    this.byParent.clear();
  }

  /**
   * Apply an event to the in-memory state.
   */
  applyEvent(event: WUEvent): void {
    const { wuId, type } = event;

    if (type === 'create' || type === 'claim') {
      const claimEvent = event as WUEvent & { lane: string; title: string };
      this._setState(wuId, WU_STATUS.IN_PROGRESS, claimEvent.lane, claimEvent.title);
      return;
    }

    if (type === 'block') {
      this._transitionToStatus(wuId, WU_STATUS.BLOCKED);
      return;
    }

    if (type === 'unblock') {
      this._transitionToStatus(wuId, WU_STATUS.IN_PROGRESS);
      return;
    }

    if (type === 'complete') {
      this._transitionToStatus(wuId, WU_STATUS.DONE);
      // WU-2244: Store completion timestamp for accurate date reporting
      const current = this.wuState.get(wuId);
      if (current) {
        current.completedAt = event.timestamp;
      }
      return;
    }

    if (type === 'checkpoint') {
      const checkpointEvent = event as WUEvent & { note?: string };
      const currentCheckpoint = this.wuState.get(wuId);
      if (currentCheckpoint) {
        currentCheckpoint.lastCheckpoint = event.timestamp;
        currentCheckpoint.lastCheckpointNote = checkpointEvent.note;
      }
      return;
    }

    if (type === DELEGATION_EVENT_TYPE) {
      const delegationEvent = event as WUEvent & { parentWuId: string };
      const { parentWuId } = delegationEvent;
      if (!this.byParent.has(parentWuId)) {
        this.byParent.set(parentWuId, new Set());
      }
      this.byParent.get(parentWuId)!.add(wuId);
      return;
    }

    // WU-1080: Handle release event - transitions from in_progress to ready
    if (type === 'release') {
      this._transitionToStatus(wuId, WU_STATUS.READY);
    }
  }

  /**
   * Get current in-memory state for a WU.
   */
  getWUState(wuId: string): WUStateEntry | undefined {
    return this.wuState.get(wuId);
  }

  /**
   * Get WU IDs by status (O(1) lookup).
   */
  getByStatus(status: string): Set<string> {
    return this.byStatus.get(status) ?? new Set();
  }

  /**
   * Get WU IDs by lane (O(1) lookup).
   */
  getByLane(lane: string): Set<string> {
    return this.byLane.get(lane) ?? new Set();
  }

  /**
   * Get child WU IDs delegated from a parent WU (O(1) lookup).
   */
  getChildWUs(parentWuId: string): Set<string> {
    return this.byParent.get(parentWuId) ?? new Set();
  }

  /**
   * Transition WU to a new status if it exists.
   */
  private _transitionToStatus(wuId: string, newStatus: string): void {
    const current = this.wuState.get(wuId);
    if (current) {
      this._setState(wuId, newStatus, current.lane, current.title);
    }
  }

  /**
   * Set WU state and update indexes.
   */
  private _setState(wuId: string, status: string, lane: string, title: string): void {
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
    this.byStatus.get(status)!.add(wuId);

    // Add to new lane index
    if (!this.byLane.has(lane)) {
      this.byLane.set(lane, new Set());
    }
    this.byLane.get(lane)!.add(wuId);
  }
}
