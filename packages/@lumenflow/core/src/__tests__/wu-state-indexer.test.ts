// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Unit tests for WUStateIndexer (WU-2043)
 *
 * Tests the state indexer in isolation:
 * - Index updates on status transitions (create/claim -> in_progress)
 * - Block/unblock transitions
 * - Complete transition with completedAt timestamp
 * - Checkpoint updates (lastCheckpoint, lastCheckpointNote)
 * - Delegation parent-child tracking
 * - Release transition (in_progress -> ready)
 * - O(1) index lookups by status, lane, parent
 * - Clear method resets all state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WUStateIndexer } from '../wu-state-indexer.js';
import type { WUEvent } from '../wu-state-schema.js';

// Helper to create typed events
function makeEvent(overrides: Partial<WUEvent> & { type: string; wuId: string }): WUEvent {
  return {
    timestamp: '2026-02-22T10:00:00.000Z',
    ...overrides,
  } as WUEvent;
}

describe('WUStateIndexer', () => {
  let indexer: WUStateIndexer;

  beforeEach(() => {
    indexer = new WUStateIndexer();
  });

  describe('applyEvent - create', () => {
    it('should set WU to in_progress on create event', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'create',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test WU',
        }),
      );

      const state = indexer.getWUState('WU-100');
      expect(state).toBeDefined();
      expect(state!.status).toBe('in_progress');
      expect(state!.lane).toBe('Framework: Core');
      expect(state!.title).toBe('Test WU');
    });

    it('should add WU to status index', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'create',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );

      const inProgress = indexer.getByStatus('in_progress');
      expect(inProgress.has('WU-100')).toBe(true);
    });

    it('should add WU to lane index', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'create',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );

      const coreLane = indexer.getByLane('Framework: Core');
      expect(coreLane.has('WU-100')).toBe(true);
    });
  });

  describe('applyEvent - claim', () => {
    it('should set WU to in_progress on claim event', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-200',
          lane: 'Operations',
          title: 'Ops WU',
        }),
      );

      const state = indexer.getWUState('WU-200');
      expect(state!.status).toBe('in_progress');
    });
  });

  describe('applyEvent - block', () => {
    it('should transition WU from in_progress to blocked', () => {
      // First create, then block
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );

      indexer.applyEvent(
        makeEvent({
          type: 'block',
          wuId: 'WU-100',
          reason: 'Dependency missing',
        }),
      );

      const state = indexer.getWUState('WU-100');
      expect(state!.status).toBe('blocked');
    });

    it('should update status index (remove from old, add to new)', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );

      indexer.applyEvent(
        makeEvent({
          type: 'block',
          wuId: 'WU-100',
          reason: 'Blocked',
        }),
      );

      expect(indexer.getByStatus('in_progress').has('WU-100')).toBe(false);
      expect(indexer.getByStatus('blocked').has('WU-100')).toBe(true);
    });

    it('should be a no-op when WU does not exist', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'block',
          wuId: 'WU-999',
          reason: 'Nonexistent',
        }),
      );

      expect(indexer.getWUState('WU-999')).toBeUndefined();
    });
  });

  describe('applyEvent - unblock', () => {
    it('should transition WU from blocked back to in_progress', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );
      indexer.applyEvent(
        makeEvent({ type: 'block', wuId: 'WU-100', reason: 'Dep' }),
      );
      indexer.applyEvent(makeEvent({ type: 'unblock', wuId: 'WU-100' }));

      expect(indexer.getWUState('WU-100')!.status).toBe('in_progress');
    });
  });

  describe('applyEvent - complete', () => {
    it('should transition WU to done and store completedAt', () => {
      const completeTimestamp = '2026-02-22T12:00:00.000Z';

      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );
      indexer.applyEvent(
        makeEvent({
          type: 'complete',
          wuId: 'WU-100',
          timestamp: completeTimestamp,
        }),
      );

      const state = indexer.getWUState('WU-100');
      expect(state!.status).toBe('done');
      expect(state!.completedAt).toBe(completeTimestamp);
    });

    it('should update status index to done', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );
      indexer.applyEvent(makeEvent({ type: 'complete', wuId: 'WU-100' }));

      expect(indexer.getByStatus('done').has('WU-100')).toBe(true);
      expect(indexer.getByStatus('in_progress').has('WU-100')).toBe(false);
    });
  });

  describe('applyEvent - checkpoint', () => {
    it('should update lastCheckpoint and lastCheckpointNote', () => {
      const checkpointTimestamp = '2026-02-22T11:00:00.000Z';

      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );
      indexer.applyEvent(
        makeEvent({
          type: 'checkpoint',
          wuId: 'WU-100',
          timestamp: checkpointTimestamp,
          note: 'Halfway done',
        }),
      );

      const state = indexer.getWUState('WU-100');
      expect(state!.lastCheckpoint).toBe(checkpointTimestamp);
      expect(state!.lastCheckpointNote).toBe('Halfway done');
    });

    it('should be a no-op when WU does not exist', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'checkpoint',
          wuId: 'WU-999',
          note: 'Ghost',
        }),
      );

      expect(indexer.getWUState('WU-999')).toBeUndefined();
    });
  });

  describe('applyEvent - delegation', () => {
    it('should track parent-child relationship', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'delegation',
          wuId: 'WU-200',
          parentWuId: 'WU-100',
          delegationId: 'del-001',
        }),
      );

      const children = indexer.getChildWUs('WU-100');
      expect(children.has('WU-200')).toBe(true);
    });

    it('should accumulate multiple children for the same parent', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'delegation',
          wuId: 'WU-200',
          parentWuId: 'WU-100',
          delegationId: 'del-001',
        }),
      );
      indexer.applyEvent(
        makeEvent({
          type: 'delegation',
          wuId: 'WU-300',
          parentWuId: 'WU-100',
          delegationId: 'del-002',
        }),
      );

      const children = indexer.getChildWUs('WU-100');
      expect(children.size).toBe(2);
      expect(children.has('WU-200')).toBe(true);
      expect(children.has('WU-300')).toBe(true);
    });
  });

  describe('applyEvent - release', () => {
    it('should transition WU from in_progress to ready', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );
      indexer.applyEvent(
        makeEvent({
          type: 'release',
          wuId: 'WU-100',
          reason: 'Agent interrupted',
        }),
      );

      expect(indexer.getWUState('WU-100')!.status).toBe('ready');
    });
  });

  describe('O(1) index lookups', () => {
    it('should return empty set for nonexistent status', () => {
      expect(indexer.getByStatus('nonexistent').size).toBe(0);
    });

    it('should return empty set for nonexistent lane', () => {
      expect(indexer.getByLane('Unknown Lane').size).toBe(0);
    });

    it('should return empty set for nonexistent parent', () => {
      expect(indexer.getChildWUs('WU-999').size).toBe(0);
    });

    it('should return undefined for nonexistent WU', () => {
      expect(indexer.getWUState('WU-999')).toBeUndefined();
    });

    it('should track multiple WUs across different lanes', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Core WU',
        }),
      );
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-200',
          lane: 'Operations',
          title: 'Ops WU',
        }),
      );

      expect(indexer.getByLane('Framework: Core').has('WU-100')).toBe(true);
      expect(indexer.getByLane('Operations').has('WU-200')).toBe(true);
      expect(indexer.getByStatus('in_progress').size).toBe(2);
    });
  });

  describe('clear', () => {
    it('should reset all state and indexes', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );
      indexer.applyEvent(
        makeEvent({
          type: 'delegation',
          wuId: 'WU-200',
          parentWuId: 'WU-100',
          delegationId: 'del-001',
        }),
      );

      indexer.clear();

      expect(indexer.getWUState('WU-100')).toBeUndefined();
      expect(indexer.getByStatus('in_progress').size).toBe(0);
      expect(indexer.getByLane('Framework: Core').size).toBe(0);
      expect(indexer.getChildWUs('WU-100').size).toBe(0);
    });
  });

  describe('lane index update on status transition', () => {
    it('should preserve lane index when status changes', () => {
      indexer.applyEvent(
        makeEvent({
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test',
        }),
      );
      indexer.applyEvent(
        makeEvent({ type: 'block', wuId: 'WU-100', reason: 'Dep' }),
      );

      // WU should still be in the lane index
      expect(indexer.getByLane('Framework: Core').has('WU-100')).toBe(true);
    });
  });
});
