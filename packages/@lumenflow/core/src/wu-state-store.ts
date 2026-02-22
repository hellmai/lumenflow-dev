// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU State Store - Facade (WU-2013)
 *
 * Thin facade delegating to: WUEventSourcer, WUStateIndexer,
 * wu-lock-manager, wu-repair-service.
 */

import { validateWUEvent, type WUEvent } from './wu-state-schema.js';
import { WU_STATUS } from './wu-constants.js';
import { WUStateIndexer } from './wu-state-indexer.js';
import { WUEventSourcer } from './wu-event-sourcer.js';

// Re-export from extracted services for backward compatibility
export { WU_EVENTS_FILE_NAME } from './wu-event-sourcer.js';
export type { WUStateEntry, CheckpointOptions } from './wu-state-indexer.js';
export { isLockStale, acquireLock, releaseLock } from './wu-lock-manager.js';
export type { LockData } from './wu-lock-manager.js';
export { repairStateFile } from './wu-repair-service.js';
export type { RepairResult } from './wu-repair-service.js';

/** Validate a WU event, throwing on failure. */
function validateOrThrow(event: Record<string, unknown>): WUEvent {
  const validation = validateWUEvent(event);
  if (!validation.success) {
    const issues = validation.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join(', ');
    throw new Error(`Validation error: ${issues}`);
  }
  return validation.data;
}

/** Assert WU is in_progress, throwing if not. */
function assertInProgress(indexer: WUStateIndexer, wuId: string): void {
  const s = indexer.getWUState(wuId);
  if (!s || s.status !== WU_STATUS.IN_PROGRESS) {
    throw new Error(`WU ${wuId} is not ${WU_STATUS.IN_PROGRESS}`);
  }
}

/**
 * WU State Store - event-sourced WU lifecycle state.
 * Delegates to focused services for each responsibility.
 */
export class WUStateStore {
  private readonly indexer: WUStateIndexer;
  private readonly sourcer: WUEventSourcer;

  constructor(baseDir: string) {
    this.indexer = new WUStateIndexer();
    this.sourcer = new WUEventSourcer(baseDir, this.indexer);
  }

  async load(): Promise<void> {
    await this.sourcer.load();
  }

  async claim(wuId: string, lane: string, title: string): Promise<void> {
    const s = this.indexer.getWUState(wuId);
    if (s && s.status === WU_STATUS.IN_PROGRESS) {
      throw new Error(`WU ${wuId} is already ${WU_STATUS.IN_PROGRESS}`);
    }
    await this.sourcer.appendAndApply({
      type: 'claim',
      wuId,
      lane,
      title,
      timestamp: new Date().toISOString(),
    } as WUEvent);
  }

  async complete(wuId: string): Promise<void> {
    assertInProgress(this.indexer, wuId);
    await this.sourcer.appendAndApply({
      type: 'complete',
      wuId,
      timestamp: new Date().toISOString(),
    } as WUEvent);
  }

  getWUState(wuId: string): ReturnType<WUStateIndexer['getWUState']> {
    return this.indexer.getWUState(wuId);
  }

  createCompleteEvent(wuId: string, timestamp: string = new Date().toISOString()): WUEvent {
    assertInProgress(this.indexer, wuId);
    return validateOrThrow({ type: 'complete', wuId, timestamp });
  }

  applyEvent(event: WUEvent): void {
    this.indexer.applyEvent(validateOrThrow(event as unknown as Record<string, unknown>));
  }

  async block(wuId: string, reason: string): Promise<void> {
    assertInProgress(this.indexer, wuId);
    await this.sourcer.appendAndApply({
      type: 'block',
      wuId,
      reason,
      timestamp: new Date().toISOString(),
    } as WUEvent);
  }

  async unblock(wuId: string): Promise<void> {
    const s = this.indexer.getWUState(wuId);
    if (!s || s.status !== WU_STATUS.BLOCKED) {
      throw new Error(`WU ${wuId} is not ${WU_STATUS.BLOCKED}`);
    }
    await this.sourcer.appendAndApply({
      type: 'unblock',
      wuId,
      timestamp: new Date().toISOString(),
    } as WUEvent);
  }

  async checkpoint(
    wuId: string,
    note: string,
    options: { sessionId?: string; progress?: string; nextSteps?: string } = {},
  ): Promise<void> {
    const { sessionId, progress, nextSteps } = options;
    const event: Record<string, unknown> = {
      type: 'checkpoint',
      wuId,
      note,
      timestamp: new Date().toISOString(),
    };
    if (sessionId) event.sessionId = sessionId;
    if (progress) event.progress = progress;
    if (nextSteps) event.nextSteps = nextSteps;
    await this.sourcer.appendAndApply(event as WUEvent);
  }

  getByStatus(status: string): Set<string> {
    return this.indexer.getByStatus(status);
  }

  getByLane(lane: string): Set<string> {
    return this.indexer.getByLane(lane);
  }

  getChildWUs(parentWuId: string): Set<string> {
    return this.indexer.getChildWUs(parentWuId);
  }

  async delegate(childWuId: string, parentWuId: string, delegationId: string): Promise<void> {
    await this.sourcer.appendAndApply({
      type: 'delegation',
      wuId: childWuId,
      parentWuId,
      delegationId,
      timestamp: new Date().toISOString(),
    } as WUEvent);
  }

  async release(wuId: string, reason: string): Promise<void> {
    assertInProgress(this.indexer, wuId);
    await this.sourcer.appendAndApply({
      type: 'release',
      wuId,
      reason,
      timestamp: new Date().toISOString(),
    } as WUEvent);
  }

  createReleaseEvent(
    wuId: string,
    reason: string,
    timestamp: string = new Date().toISOString(),
  ): WUEvent {
    assertInProgress(this.indexer, wuId);
    return validateOrThrow({ type: 'release', wuId, reason, timestamp });
  }
}
