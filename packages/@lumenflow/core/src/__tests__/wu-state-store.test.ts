/**
 * @file wu-state-store.test.ts
 * @description Tests for WU State Store including release event (WU-1080)
 *
 * WU-1102: Additional tests for comprehensive coverage
 *
 * Tests cover:
 * - Release event type in schema
 * - State store handles release event on replay
 * - release() method transitions WU from in_progress to ready
 * - Cannot release a WU that is not in_progress
 * - createReleaseEvent() for transactional flows
 * - load() method with various file states
 * - claim(), complete(), block(), unblock() methods
 * - checkpoint() and spawn() methods
 * - createCompleteEvent() method
 * - getByStatus(), getByLane(), getChildWUs() methods
 * - isLockStale(), acquireLock(), releaseLock(), repairStateFile()
 */

import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  WUStateStore,
  WU_EVENTS_FILE_NAME,
  isLockStale,
  acquireLock,
  releaseLock,
  repairStateFile,
} from '../wu-state-store.js';
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

describe('WU State Store - Core Operations (WU-1102)', () => {
  let tempDir: string;
  let store: WUStateStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wu-state-store-core-test-'));
    store = new WUStateStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('WU_EVENTS_FILE_NAME export', () => {
    it('should export the correct file name', () => {
      expect(WU_EVENTS_FILE_NAME).toBe('wu-events.jsonl');
    });
  });

  describe('load()', () => {
    it('should return empty state when file does not exist', async () => {
      await store.load();

      expect(store.getByStatus('in_progress').size).toBe(0);
      expect(store.getByStatus('ready').size).toBe(0);
    });

    it('should handle empty file', async () => {
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), '');

      await store.load();

      expect(store.getByStatus('in_progress').size).toBe(0);
    });

    it('should skip empty lines', async () => {
      const events = [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-1',
          lane: 'Test',
          title: 'Test',
          timestamp: new Date().toISOString(),
        }),
        '',
        '   ',
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-2',
          lane: 'Test',
          title: 'Test',
          timestamp: new Date().toISOString(),
        }),
      ];
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), events.join('\n'));

      await store.load();

      expect(store.getByStatus('in_progress').size).toBe(2);
    });

    it('should throw on malformed JSON', async () => {
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), 'not valid json');

      await expect(store.load()).rejects.toThrow(/Malformed JSON/);
    });

    it('should throw on invalid event schema', async () => {
      await writeFile(
        path.join(tempDir, WU_EVENTS_FILE_NAME),
        JSON.stringify({ type: 'invalid-type', wuId: 'WU-1' }),
      );

      await expect(store.load()).rejects.toThrow(/Validation error/);
    });

    it('should replay create events', async () => {
      const event = JSON.stringify({
        type: 'create',
        wuId: 'WU-2001',
        lane: 'Test',
        title: 'Created WU',
        timestamp: new Date().toISOString(),
      });
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), event + '\n');

      await store.load();

      const state = store.getWUState('WU-2001');
      expect(state?.status).toBe('in_progress');
    });

    it('should replay block events', async () => {
      const events = [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-2002',
          lane: 'Test',
          title: 'Test',
          timestamp: '2026-01-01T00:00:00Z',
        }),
        JSON.stringify({
          type: 'block',
          wuId: 'WU-2002',
          reason: 'Dependency',
          timestamp: '2026-01-01T01:00:00Z',
        }),
      ];
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), events.join('\n') + '\n');

      await store.load();

      const state = store.getWUState('WU-2002');
      expect(state?.status).toBe('blocked');
    });

    it('should replay unblock events', async () => {
      const events = [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-2003',
          lane: 'Test',
          title: 'Test',
          timestamp: '2026-01-01T00:00:00Z',
        }),
        JSON.stringify({
          type: 'block',
          wuId: 'WU-2003',
          reason: 'Dependency',
          timestamp: '2026-01-01T01:00:00Z',
        }),
        JSON.stringify({
          type: 'unblock',
          wuId: 'WU-2003',
          timestamp: '2026-01-01T02:00:00Z',
        }),
      ];
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), events.join('\n') + '\n');

      await store.load();

      const state = store.getWUState('WU-2003');
      expect(state?.status).toBe('in_progress');
    });

    it('should replay complete events with timestamp', async () => {
      const events = [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-2004',
          lane: 'Test',
          title: 'Test',
          timestamp: '2026-01-01T00:00:00Z',
        }),
        JSON.stringify({
          type: 'complete',
          wuId: 'WU-2004',
          timestamp: '2026-01-01T02:00:00Z',
        }),
      ];
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), events.join('\n') + '\n');

      await store.load();

      const state = store.getWUState('WU-2004');
      expect(state?.status).toBe('done');
      expect(state?.completedAt).toBe('2026-01-01T02:00:00Z');
    });

    it('should replay checkpoint events', async () => {
      const events = [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-2005',
          lane: 'Test',
          title: 'Test',
          timestamp: '2026-01-01T00:00:00Z',
        }),
        JSON.stringify({
          type: 'checkpoint',
          wuId: 'WU-2005',
          note: 'Progress made',
          timestamp: '2026-01-01T01:00:00Z',
        }),
      ];
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), events.join('\n') + '\n');

      await store.load();

      const state = store.getWUState('WU-2005');
      expect(state?.lastCheckpoint).toBe('2026-01-01T01:00:00Z');
      expect(state?.lastCheckpointNote).toBe('Progress made');
    });

    it('should replay spawn events', async () => {
      const events = [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-3001',
          lane: 'Test',
          title: 'Parent',
          timestamp: '2026-01-01T00:00:00Z',
        }),
        JSON.stringify({
          type: 'spawn',
          wuId: 'WU-3002',
          parentWuId: 'WU-3001',
          spawnId: 'spawn-123',
          timestamp: '2026-01-01T01:00:00Z',
        }),
      ];
      await writeFile(path.join(tempDir, WU_EVENTS_FILE_NAME), events.join('\n') + '\n');

      await store.load();

      const children = store.getChildWUs('WU-3001');
      expect(children.has('WU-3002')).toBe(true);
    });

    it('should clear previous state on reload', async () => {
      // First load
      await store.claim('WU-2006', 'Test', 'Old WU');

      // Overwrite file with different content
      await writeFile(
        path.join(tempDir, WU_EVENTS_FILE_NAME),
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-2007',
          lane: 'Test',
          title: 'New',
          timestamp: new Date().toISOString(),
        }) + '\n',
      );

      await store.load();

      expect(store.getWUState('WU-2006')).toBeUndefined();
      expect(store.getWUState('WU-2007')).toBeDefined();
    });
  });

  describe('claim()', () => {
    it('should create WU in in_progress status', async () => {
      await store.claim('WU-2007', 'Framework: Core', 'New feature');

      const state = store.getWUState('WU-2007');
      expect(state?.status).toBe('in_progress');
      expect(state?.lane).toBe('Framework: Core');
      expect(state?.title).toBe('New feature');
    });

    it('should throw when claiming already in_progress WU', async () => {
      await store.claim('WU-2008', 'Test', 'First claim');

      await expect(store.claim('WU-2008', 'Test', 'Second claim')).rejects.toThrow(
        /already in_progress/,
      );
    });

    it('should add WU to status and lane indexes', async () => {
      await store.claim('WU-2009', 'My Lane', 'Indexed WU');

      expect(store.getByStatus('in_progress').has('WU-2009')).toBe(true);
      expect(store.getByLane('My Lane').has('WU-2009')).toBe(true);
    });

    it('should persist claim event to file', async () => {
      await store.claim('WU-2010', 'Test', 'Persisted');

      const content = await readFile(path.join(tempDir, WU_EVENTS_FILE_NAME), 'utf-8');
      expect(content).toContain('WU-2010');
      expect(content).toContain('"type":"claim"');
    });

    it('should create directory if not exists', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'state');
      const nestedStore = new WUStateStore(nestedDir);

      await nestedStore.claim('WU-2011', 'Test', 'Nested');

      expect(existsSync(nestedDir)).toBe(true);
    });
  });

  describe('complete()', () => {
    it('should transition WU to done status', async () => {
      await store.claim('WU-2012', 'Test', 'To be completed');
      await store.complete('WU-2012');

      const state = store.getWUState('WU-2012');
      expect(state?.status).toBe('done');
    });

    it('should throw when completing non-existent WU', async () => {
      await expect(store.complete('WU-2013')).rejects.toThrow(/not in_progress/);
    });

    it('should throw when completing already done WU', async () => {
      await store.claim('WU-2014', 'Test', 'Test');
      await store.complete('WU-2014');

      await expect(store.complete('WU-2014')).rejects.toThrow(/not in_progress/);
    });
  });

  describe('block() and unblock()', () => {
    it('should block an in_progress WU', async () => {
      await store.claim('WU-2015', 'Test', 'To be blocked');
      await store.block('WU-2015', 'Waiting for dependency');

      const state = store.getWUState('WU-2015');
      expect(state?.status).toBe('blocked');
    });

    it('should throw when blocking non-in_progress WU', async () => {
      await expect(store.block('WU-2016', 'reason')).rejects.toThrow(/not in_progress/);
    });

    it('should unblock a blocked WU', async () => {
      await store.claim('WU-2017', 'Test', 'Test');
      await store.block('WU-2017', 'Blocked');
      await store.unblock('WU-2017');

      const state = store.getWUState('WU-2017');
      expect(state?.status).toBe('in_progress');
    });

    it('should throw when unblocking non-blocked WU', async () => {
      await store.claim('WU-2018', 'Test', 'Test');

      await expect(store.unblock('WU-2018')).rejects.toThrow(/not blocked/);
    });
  });

  describe('checkpoint()', () => {
    it('should record checkpoint without changing status', async () => {
      await store.claim('WU-20052', 'Test', 'Test');
      await store.checkpoint('WU-20052', 'Made progress');

      const state = store.getWUState('WU-20052');
      expect(state?.status).toBe('in_progress');
      expect(state?.lastCheckpointNote).toBe('Made progress');
    });

    it('should accept optional sessionId, progress, nextSteps', async () => {
      await store.claim('WU-20053', 'Test', 'Test');
      await store.checkpoint('WU-20053', 'Note', {
        sessionId: 'sess-123',
        progress: '50%',
        nextSteps: 'Continue',
      });

      const state = store.getWUState('WU-20053');
      expect(state?.lastCheckpoint).toBeDefined();
    });
  });

  describe('spawn()', () => {
    it('should record parent-child relationship', async () => {
      await store.spawn('WU-3030', 'WU-3031', 'spawn-001');

      const children = store.getChildWUs('WU-3031');
      expect(children.has('WU-3030')).toBe(true);
    });

    it('should handle multiple children', async () => {
      await store.spawn('WU-3010', 'WU-3013', 'spawn-1');
      await store.spawn('WU-3011', 'WU-3013', 'spawn-2');
      await store.spawn('WU-3012', 'WU-3013', 'spawn-3');

      const children = store.getChildWUs('WU-3013');
      expect(children.size).toBe(3);
    });
  });

  describe('createCompleteEvent()', () => {
    it('should create complete event without writing', async () => {
      await store.claim('WU-3020', 'Test', 'Test');

      const event = store.createCompleteEvent('WU-3020');

      expect(event.type).toBe('complete');
      expect(event.wuId).toBe('WU-3020');

      // State should still be in_progress
      const state = store.getWUState('WU-3020');
      expect(state?.status).toBe('in_progress');
    });

    it('should throw for non-in_progress WU', async () => {
      expect(() => store.createCompleteEvent('WU-2016')).toThrow(/not in_progress/);
    });

    it('should accept custom timestamp', async () => {
      await store.claim('WU-3021', 'Test', 'Test');

      const event = store.createCompleteEvent('WU-3021', '2026-06-15T12:00:00Z');

      expect(event.timestamp).toBe('2026-06-15T12:00:00Z');
    });
  });

  describe('applyEvent()', () => {
    it('should apply event to in-memory state', async () => {
      await store.claim('WU-3022', 'Test', 'Test');

      const event = {
        type: 'complete' as const,
        wuId: 'WU-3022',
        timestamp: new Date().toISOString(),
      };

      store.applyEvent(event);

      const state = store.getWUState('WU-3022');
      expect(state?.status).toBe('done');
    });

    it('should throw on invalid event', () => {
      expect(() =>
        store.applyEvent({ type: 'invalid' as never, wuId: 'WU-3023', timestamp: '2026-01-01' }),
      ).toThrow(/Validation error/);
    });
  });

  describe('getByStatus() and getByLane()', () => {
    it('should return empty set for unknown status', () => {
      expect(store.getByStatus('nonexistent').size).toBe(0);
    });

    it('should return empty set for unknown lane', () => {
      expect(store.getByLane('Unknown Lane').size).toBe(0);
    });

    it('should update indexes when status changes', async () => {
      await store.claim('WU-3024', 'Test', 'Test');
      expect(store.getByStatus('in_progress').has('WU-3024')).toBe(true);

      await store.complete('WU-3024');
      expect(store.getByStatus('in_progress').has('WU-3024')).toBe(false);
      expect(store.getByStatus('done').has('WU-3024')).toBe(true);
    });
  });

  describe('getChildWUs()', () => {
    it('should return empty set for WU without children', () => {
      expect(store.getChildWUs('WU-3025').size).toBe(0);
    });
  });
});

describe('Lock utilities (WU-1102)', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wu-lock-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('isLockStale()', () => {
    it('should return true for expired lock (>5 min)', () => {
      const lockData = {
        pid: process.pid,
        timestamp: Date.now() - 6 * 60 * 1000, // 6 minutes ago
        hostname: hostname(),
      };

      expect(isLockStale(lockData)).toBe(true);
    });

    it('should return false for recent lock with running process', () => {
      const lockData = {
        pid: process.pid, // Current process is running
        timestamp: Date.now(),
        hostname: hostname(),
      };

      expect(isLockStale(lockData)).toBe(false);
    });

    it('should return true for dead process on same host', () => {
      const lockData = {
        pid: 999999999, // Non-existent PID
        timestamp: Date.now(),
        hostname: hostname(),
      };

      expect(isLockStale(lockData)).toBe(true);
    });

    it('should only use timeout for different hostname', () => {
      const lockData = {
        pid: 999999999,
        timestamp: Date.now(),
        hostname: 'different-host.example.com',
      };

      // Cannot check PID on different host, so not stale (within timeout)
      expect(isLockStale(lockData)).toBe(false);
    });
  });

  describe('acquireLock() and releaseLock()', () => {
    it('should acquire and release lock', async () => {
      const lockPath = path.join(tempDir, 'test.lock');

      await acquireLock(lockPath);
      expect(existsSync(lockPath)).toBe(true);

      releaseLock(lockPath);
      expect(existsSync(lockPath)).toBe(false);
    });

    it('should create parent directories', async () => {
      const lockPath = path.join(tempDir, 'nested', 'dir', 'test.lock');

      await acquireLock(lockPath);

      expect(existsSync(lockPath)).toBe(true);

      releaseLock(lockPath);
    });

    it('should handle removing already-removed lock', () => {
      const lockPath = path.join(tempDir, 'nonexistent.lock');

      // Should not throw
      expect(() => releaseLock(lockPath)).not.toThrow();
    });
  });

  describe('repairStateFile()', () => {
    it('should return success for non-existent file', async () => {
      const filePath = path.join(tempDir, 'nonexistent.jsonl');

      const result = await repairStateFile(filePath);

      expect(result.success).toBe(true);
      expect(result.linesKept).toBe(0);
      expect(result.linesRemoved).toBe(0);
      expect(result.backupPath).toBeNull();
      expect(result.warnings).toContain('File does not exist, nothing to repair');
    });

    it('should keep valid lines and remove invalid ones', async () => {
      const filePath = path.join(tempDir, 'mixed.jsonl');
      const content = [
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-1',
          lane: 'Test',
          title: 'Valid',
          timestamp: new Date().toISOString(),
        }),
        'not valid json',
        JSON.stringify({
          type: 'claim',
          wuId: 'WU-2',
          lane: 'Test',
          title: 'Also valid',
          timestamp: new Date().toISOString(),
        }),
        JSON.stringify({ type: 'invalid-type' }), // Invalid schema
      ].join('\n');
      await writeFile(filePath, content);

      const result = await repairStateFile(filePath);

      expect(result.success).toBe(true);
      expect(result.linesKept).toBe(2);
      expect(result.linesRemoved).toBe(2);
      expect(result.backupPath).toContain('backup');
    });

    it('should create backup file', async () => {
      const filePath = path.join(tempDir, 'backup-test.jsonl');
      await writeFile(filePath, 'invalid content');

      const result = await repairStateFile(filePath);

      expect(result.backupPath).not.toBeNull();
      expect(existsSync(result.backupPath!)).toBe(true);
    });

    it('should warn when all lines are invalid', async () => {
      const filePath = path.join(tempDir, 'all-invalid.jsonl');
      await writeFile(filePath, 'bad\nworse\nworst');

      const result = await repairStateFile(filePath);

      expect(result.linesKept).toBe(0);
      expect(result.warnings).toContainEqual(expect.stringContaining('All lines were invalid'));
    });

    it('should handle empty file', async () => {
      const filePath = path.join(tempDir, 'empty.jsonl');
      await writeFile(filePath, '');

      const result = await repairStateFile(filePath);

      expect(result.success).toBe(true);
      expect(result.linesKept).toBe(0);
      expect(result.linesRemoved).toBe(0);
    });

    it('should remove git conflict marker lines and keep valid events', async () => {
      const filePath = path.join(tempDir, 'conflicted-wu-events.jsonl');
      const validClaim = JSON.stringify({
        type: 'claim',
        wuId: 'WU-1673',
        lane: 'Framework: Core Lifecycle',
        title: 'Repair conflicted state log',
        timestamp: '2026-02-14T12:00:00.000Z',
      });
      const validComplete = JSON.stringify({
        type: 'complete',
        wuId: 'WU-1672',
        timestamp: '2026-02-14T11:59:00.000Z',
      });
      const conflictedContent = [
        validClaim,
        '<<<<<<< HEAD',
        validComplete,
        '=======',
        validClaim,
        '>>>>>>> origin/main',
      ].join('\n');
      await writeFile(filePath, conflictedContent);

      const result = await repairStateFile(filePath);
      const repaired = await readFile(filePath, 'utf-8');

      expect(result.success).toBe(true);
      expect(result.linesKept).toBe(3);
      expect(result.linesRemoved).toBe(3);
      expect(repaired).not.toContain('<<<<<<<');
      expect(repaired).not.toContain('=======');
      expect(repaired).not.toContain('>>>>>>>');
    });
  });
});

/**
 * WU-1419: Tests for wu:recover reset action emitting release event
 *
 * This test suite verifies that when wu:recover --action reset is called,
 * the state store receives a release event to transition the WU from
 * in_progress to ready. Without this, re-claiming fails due to WIP limits.
 */
describe('WU State Store - Reset Recovery with Release Event (WU-1419)', () => {
  let tempDir: string;
  let store: WUStateStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'wu-state-store-reset-test-'));
    store = new WUStateStore(tempDir);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('Reset scenario requiring release event', () => {
    it('should allow reclaim after release event is emitted', async () => {
      // Simulate the wu:recover --action reset workflow:
      // 1. WU is claimed (in_progress in state store)
      await store.claim('WU-1419', 'Framework: Core', 'Test reset WU');
      expect(store.getWUState('WU-1419')?.status).toBe('in_progress');

      // 2. Release event is emitted (transitions to ready)
      await store.release('WU-1419', 'Reset via wu:recover');
      expect(store.getWUState('WU-1419')?.status).toBe('ready');

      // 3. WU can be re-claimed (no longer blocked by WIP limit)
      await store.claim('WU-1419', 'Framework: Core', 'Test reset WU');
      expect(store.getWUState('WU-1419')?.status).toBe('in_progress');
    });

    it('should free lane WIP after release event', async () => {
      // Claim WU - lane should show this WU as in_progress
      await store.claim('WU-1419', 'Framework: Core', 'Test WU');
      expect(store.getByStatus('in_progress').has('WU-1419')).toBe(true);
      expect(store.getByLane('Framework: Core').has('WU-1419')).toBe(true);

      // Release WU - should transition to ready
      await store.release('WU-1419', 'Reset via wu:recover');
      expect(store.getByStatus('ready').has('WU-1419')).toBe(true);
      expect(store.getByStatus('in_progress').has('WU-1419')).toBe(false);
    });

    it('should persist release event to events file', async () => {
      await store.claim('WU-1419', 'Framework: Core', 'Test WU');
      await store.release('WU-1419', 'Reset via wu:recover');

      // Verify event was persisted by loading in new store instance
      const store2 = new WUStateStore(tempDir);
      await store2.load();
      expect(store2.getWUState('WU-1419')?.status).toBe('ready');
    });

    it('should include reason in release event', async () => {
      await store.claim('WU-1419', 'Framework: Core', 'Test WU');
      await store.release('WU-1419', 'Reset via wu:recover --action reset');

      // Read the events file to verify reason is included
      const eventsContent = await readFile(path.join(tempDir, WU_EVENTS_FILE_NAME), 'utf-8');
      expect(eventsContent).toContain('Reset via wu:recover --action reset');
      expect(eventsContent).toContain('"type":"release"');
    });
  });
});
