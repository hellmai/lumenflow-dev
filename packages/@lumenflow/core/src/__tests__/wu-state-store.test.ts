/**
 * @file wu-state-store.test.ts
 * @description Tests for WU State Store including release event (WU-1080)
 *
 * Tests cover:
 * - Release event type in schema
 * - State store handles release event on replay
 * - release() method transitions WU from in_progress to ready
 * - Cannot release a WU that is not in_progress
 * - createReleaseEvent() for transactional flows
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WUStateStore } from '../wu-state-store.js';
import { validateWUEvent, WU_EVENT_TYPES } from '../wu-state-schema.js';

describe('WU State Store - Release Event (WU-1080)', () => {
  let tempDir: string;
  let store: WUStateStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wu-state-store-test-'));
    store = new WUStateStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Schema validation', () => {
    it('should include release in WU_EVENT_TYPES', () => {
      expect(WU_EVENT_TYPES).toContain('release');
    });

    it('should validate a well-formed release event', () => {
      const releaseEvent = {
        type: 'release',
        wuId: 'WU-1080',
        timestamp: new Date().toISOString(),
        reason: 'Agent interrupted mid-WU',
      };

      const result = validateWUEvent(releaseEvent);
      expect(result.success).toBe(true);
    });

    it('should reject release event without reason', () => {
      const releaseEvent = {
        type: 'release',
        wuId: 'WU-1080',
        timestamp: new Date().toISOString(),
      };

      const result = validateWUEvent(releaseEvent);
      expect(result.success).toBe(false);
    });

    it('should reject release event with empty reason', () => {
      const releaseEvent = {
        type: 'release',
        wuId: 'WU-1080',
        timestamp: new Date().toISOString(),
        reason: '',
      };

      const result = validateWUEvent(releaseEvent);
      expect(result.success).toBe(false);
    });
  });

  describe('State store load with release events', () => {
    it('should replay release event and transition to ready', async () => {
      // Write events file with claim followed by release
      const events = [
        {
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test WU',
          timestamp: '2026-01-23T10:00:00.000Z',
        },
        {
          type: 'release',
          wuId: 'WU-100',
          reason: 'Agent interrupted',
          timestamp: '2026-01-23T11:00:00.000Z',
        },
      ];

      const eventsContent = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await writeFile(path.join(tempDir, 'wu-events.jsonl'), eventsContent);

      await store.load();

      const state = store.getWUState('WU-100');
      expect(state).toBeDefined();
      expect(state?.status).toBe('ready');
    });

    it('should correctly index released WU by status', async () => {
      // Write events file with claim followed by release
      const events = [
        {
          type: 'claim',
          wuId: 'WU-100',
          lane: 'Framework: Core',
          title: 'Test WU',
          timestamp: '2026-01-23T10:00:00.000Z',
        },
        {
          type: 'release',
          wuId: 'WU-100',
          reason: 'Agent interrupted',
          timestamp: '2026-01-23T11:00:00.000Z',
        },
      ];

      const eventsContent = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
      await writeFile(path.join(tempDir, 'wu-events.jsonl'), eventsContent);

      await store.load();

      expect(store.getByStatus('ready').has('WU-100')).toBe(true);
      expect(store.getByStatus('in_progress').has('WU-100')).toBe(false);
    });
  });

  describe('release() method', () => {
    it('should release an in_progress WU and transition to ready', async () => {
      await store.claim('WU-200', 'Framework: Core', 'Test WU');

      await store.release('WU-200', 'Agent interrupted');

      const state = store.getWUState('WU-200');
      expect(state?.status).toBe('ready');
    });

    it('should throw when releasing a WU that is not in_progress', async () => {
      await store.claim('WU-300', 'Framework: Core', 'Test WU');
      await store.complete('WU-300');

      await expect(store.release('WU-300', 'Trying to release')).rejects.toThrow(
        'WU WU-300 is not in_progress',
      );
    });

    it('should throw when releasing a WU that does not exist', async () => {
      await expect(store.release('WU-999', 'Non-existent WU')).rejects.toThrow(
        'WU WU-999 is not in_progress',
      );
    });

    it('should throw when releasing a blocked WU', async () => {
      await store.claim('WU-400', 'Framework: Core', 'Test WU');
      await store.block('WU-400', 'Dependency issue');

      await expect(store.release('WU-400', 'Trying to release blocked')).rejects.toThrow(
        'WU WU-400 is not in_progress',
      );
    });

    it('should allow reclaiming a released WU', async () => {
      await store.claim('WU-500', 'Framework: Core', 'Test WU');
      await store.release('WU-500', 'Agent interrupted');

      // Should be able to claim again
      await store.claim('WU-500', 'Framework: Core', 'Test WU');

      const state = store.getWUState('WU-500');
      expect(state?.status).toBe('in_progress');
    });

    it('should persist release event to file', async () => {
      await store.claim('WU-600', 'Framework: Core', 'Test WU');
      await store.release('WU-600', 'Agent interrupted');

      // Create new store instance and load
      const store2 = new WUStateStore(tempDir);
      await store2.load();

      const state = store2.getWUState('WU-600');
      expect(state?.status).toBe('ready');
    });
  });

  describe('createReleaseEvent() method', () => {
    it('should create a validated release event without writing to disk', async () => {
      await store.claim('WU-700', 'Framework: Core', 'Test WU');

      const event = store.createReleaseEvent('WU-700', 'Agent interrupted');

      expect(event.type).toBe('release');
      expect(event.wuId).toBe('WU-700');
      expect(event.reason).toBe('Agent interrupted');
      expect(event.timestamp).toBeDefined();

      // State should still be in_progress (not written to disk)
      const state = store.getWUState('WU-700');
      expect(state?.status).toBe('in_progress');
    });

    it('should throw when creating release event for non-in_progress WU', async () => {
      expect(() => store.createReleaseEvent('WU-999', 'Non-existent')).toThrow(
        'WU WU-999 is not in_progress',
      );
    });

    it('should allow applying created release event', async () => {
      await store.claim('WU-800', 'Framework: Core', 'Test WU');

      const event = store.createReleaseEvent('WU-800', 'Agent interrupted');
      store.applyEvent(event);

      const state = store.getWUState('WU-800');
      expect(state?.status).toBe('ready');
    });
  });

  describe('Integration with other operations', () => {
    it('should maintain lane index correctly after release', async () => {
      await store.claim('WU-900', 'Framework: Core', 'Test WU');
      await store.release('WU-900', 'Agent interrupted');

      // WU should still be in the lane index
      expect(store.getByLane('Framework: Core').has('WU-900')).toBe(true);
    });

    it('should handle multiple release cycles', async () => {
      // First cycle
      await store.claim('WU-1000', 'Framework: Core', 'Test WU');
      await store.release('WU-1000', 'First interruption');

      // Second cycle
      await store.claim('WU-1000', 'Framework: Core', 'Test WU');
      await store.release('WU-1000', 'Second interruption');

      // Third cycle - complete this time
      await store.claim('WU-1000', 'Framework: Core', 'Test WU');
      await store.complete('WU-1000');

      const state = store.getWUState('WU-1000');
      expect(state?.status).toBe('done');
    });
  });
});
