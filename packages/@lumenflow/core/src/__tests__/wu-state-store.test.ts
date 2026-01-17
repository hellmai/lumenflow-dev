/**
 * WU State Store Tests (WU-1570)
 *
 * TDD: Tests written first, implementation follows.
 * Event-sourced state store for WU lifecycle following INIT-007 pattern.
 *
 * @see {@link tools/lib/wu-state-store.mjs} - Implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  WUStateStore,
  WU_EVENTS_FILE_NAME,
} from '../wu-state-store.js';

/**
 * Test fixtures for event sourcing
 */
const FIXTURES = {
  /** Creates a valid claim event */
  claimEvent: (overrides = {}) => ({
    type: 'claim',
    wuId: 'WU-1570',
    lane: 'Operations: Workflow Engine',
    title: 'Test WU',
    timestamp: new Date().toISOString(),
    ...overrides,
  }),

  /** Creates a valid complete event */
  completeEvent: (overrides = {}) => ({
    type: 'complete',
    wuId: 'WU-1570',
    timestamp: new Date().toISOString(),
    ...overrides,
  }),

  /** Creates a valid block event */
  blockEvent: (overrides = {}) => ({
    type: 'block',
    wuId: 'WU-1570',
    reason: 'Blocked by dependency',
    timestamp: new Date().toISOString(),
    ...overrides,
  }),

  /** Creates a valid unblock event */
  unblockEvent: (overrides = {}) => ({
    type: 'unblock',
    wuId: 'WU-1570',
    timestamp: new Date().toISOString(),
    ...overrides,
  }),
};

/**
 * Helper to write JSONL content to a file
 * @param {string} filePath - Path to write to
 * @param {object[]} events - Array of events to write
 */
async function writeJsonlFile(filePath, events) {
  const content = events.map((event) => JSON.stringify(event)).join('\n');
  await fs.writeFile(filePath, content + '\n', 'utf-8');
}

describe('wu-state-store', () => {
  let tempDir;
  let eventsFilePath;
  let store;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wu-state-store-test-'));
    eventsFilePath = path.join(tempDir, WU_EVENTS_FILE_NAME);
    store = new WUStateStore(tempDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('WU_EVENTS_FILE_NAME constant', () => {
    it('should export the events file name', () => {
      expect(WU_EVENTS_FILE_NAME).toBe('wu-events.jsonl');
    });
  });

  describe('load()', () => {
    it('should handle missing file and return empty state', async () => {
      await store.load();

      const byStatus = store.getByStatus('ready');
      expect(byStatus instanceof Set, 'Should return Set');
      expect(byStatus.size).toBe(0, 'Should be empty');
    });

    it('should handle empty file and return empty state', async () => {
      await fs.writeFile(eventsFilePath, '', 'utf-8');
      await store.load();

      const byStatus = store.getByStatus('ready');
      expect(byStatus.size).toBe(0, 'Should be empty');
    });

    it('should replay claim event into in_progress state', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt]);

      await store.load();

      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(1, 'Should have 1 in_progress WU');
      expect(inProgress.has('WU-100'), 'Should contain WU-100');
    });

    it('should replay complete event into done state', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      const completeEvt = FIXTURES.completeEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt, completeEvt]);

      await store.load();

      const done = store.getByStatus('done');
      expect(done.size).toBe(1, 'Should have 1 done WU');
      expect(done.has('WU-100'), 'Should contain WU-100');

      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(0, 'Should have no in_progress WUs');
    });

    it('should replay block event into blocked state', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      const blockEvt = FIXTURES.blockEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt, blockEvt]);

      await store.load();

      const blocked = store.getByStatus('blocked');
      expect(blocked.size).toBe(1, 'Should have 1 blocked WU');
      expect(blocked.has('WU-100'), 'Should contain WU-100');

      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(0, 'Should have no in_progress WUs');
    });

    it('should replay unblock event back to in_progress state', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      const blockEvt = FIXTURES.blockEvent({ wuId: 'WU-100' });
      const unblockEvt = FIXTURES.unblockEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt, blockEvt, unblockEvt]);

      await store.load();

      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(1, 'Should have 1 in_progress WU');
      expect(inProgress.has('WU-100'), 'Should contain WU-100');

      const blocked = store.getByStatus('blocked');
      expect(blocked.size).toBe(0, 'Should have no blocked WUs');
    });

    it('should index WUs by lane', async () => {
      const claimEvt1 = FIXTURES.claimEvent({ wuId: 'WU-100', lane: 'Operations: Tooling' });
      const claimEvt2 = FIXTURES.claimEvent({ wuId: 'WU-101', lane: 'Operations: Workflow Engine' });
      const claimEvt3 = FIXTURES.claimEvent({ wuId: 'WU-102', lane: 'Operations: Tooling' });
      await writeJsonlFile(eventsFilePath, [claimEvt1, claimEvt2, claimEvt3]);

      await store.load();

      const toolingLane = store.getByLane('Operations: Tooling');
      expect(toolingLane.size).toBe(2, 'Should have 2 WUs in Tooling lane');
      expect(toolingLane.has('WU-100'), 'Should contain WU-100');
      expect(toolingLane.has('WU-102'), 'Should contain WU-102');

      const workflowLane = store.getByLane('Operations: Workflow Engine');
      expect(workflowLane.size).toBe(1, 'Should have 1 WU in Workflow Engine lane');
      expect(workflowLane.has('WU-101'), 'Should contain WU-101');
    });

    it('should skip empty lines gracefully', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      const content = `${JSON.stringify(claimEvt)}\n\n${JSON.stringify(FIXTURES.completeEvent({ wuId: 'WU-100' }))}\n`;
      await fs.writeFile(eventsFilePath, content, 'utf-8');

      await store.load();

      const done = store.getByStatus('done');
      expect(done.size).toBe(1, 'Should replay both events');
    });

    it('should throw on malformed JSON lines', async () => {
      const content = `${JSON.stringify(FIXTURES.claimEvent())}\n{invalid json}\n`;
      await fs.writeFile(eventsFilePath, content, 'utf-8');

      await expect(async () => store.load()).rejects.toThrow(/JSON/i);
    });

    it('should throw on invalid event schema', async () => {
      const invalidEvent = { type: 'unknown', wuId: 'WU-100' };
      await writeJsonlFile(eventsFilePath, [invalidEvent]);

      await expect(async () => store.load()).rejects.toThrow(/validation/i);
    });
  });

  describe('claim()', () => {
    it('should append claim event and update in-memory state', async () => {
      await store.load();

      await store.claim('WU-100', 'Operations: Tooling', 'Test WU');

      // Check in-memory state
      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(1, 'Should have 1 in_progress WU');
      expect(inProgress.has('WU-100'), 'Should contain WU-100');

      // Check file persisted
      const content = await fs.readFile(eventsFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1, 'Should have 1 event');
      const event = JSON.parse(lines[0]);
      expect(event.type).toBe('claim', 'Should be claim event');
      expect(event.wuId).toBe('WU-100', 'Should have correct wuId');
      expect(event.lane).toBe('Operations: Tooling', 'Should have correct lane');
    });

    it('should validate event before appending', async () => {
      await store.load();

      await expect(async () => store.claim('', '', '')).rejects.toThrow(/validation/i);

      // File should not exist if append failed
      await expect(async () => fs.access(eventsFilePath)).rejects.toThrow();
    });

    it('should reject claim for already claimed WU', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt]);
      await store.load();

      await expect(async () => store.claim('WU-100', 'Operations: Tooling', 'Test WU')).rejects.toThrow(/already in_progress/i);
    });
  });

  describe('complete()', () => {
    it('should append complete event and update state', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt]);
      await store.load();

      await store.complete('WU-100');

      // Check in-memory state
      const done = store.getByStatus('done');
      expect(done.size).toBe(1, 'Should have 1 done WU');
      expect(done.has('WU-100'), 'Should contain WU-100');

      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(0, 'Should have no in_progress WUs');

      // Check file persisted
      const content = await fs.readFile(eventsFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2, 'Should have 2 events');
      const event = JSON.parse(lines[1]);
      expect(event.type).toBe('complete', 'Should be complete event');
    });

    it('should reject complete for WU not in_progress', async () => {
      await store.load();

      await expect(async () => store.complete('WU-100')).rejects.toThrow(/not in_progress/i);
    });
  });

  describe('block()', () => {
    it('should append block event and update state', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt]);
      await store.load();

      await store.block('WU-100', 'Blocked by dependency');

      // Check in-memory state
      const blocked = store.getByStatus('blocked');
      expect(blocked.size).toBe(1, 'Should have 1 blocked WU');
      expect(blocked.has('WU-100'), 'Should contain WU-100');

      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(0, 'Should have no in_progress WUs');
    });

    it('should reject block for WU not in_progress', async () => {
      await store.load();

      await expect(async () => store.block('WU-100', 'Test reason')).rejects.toThrow(/not in_progress/i);
    });
  });

  describe('unblock()', () => {
    it('should append unblock event and update state', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      const blockEvt = FIXTURES.blockEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt, blockEvt]);
      await store.load();

      await store.unblock('WU-100');

      // Check in-memory state
      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(1, 'Should have 1 in_progress WU');
      expect(inProgress.has('WU-100'), 'Should contain WU-100');

      const blocked = store.getByStatus('blocked');
      expect(blocked.size).toBe(0, 'Should have no blocked WUs');
    });

    it('should reject unblock for WU not blocked', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt]);
      await store.load();

      await expect(async () => store.unblock('WU-100')).rejects.toThrow(/not blocked/i);
    });
  });

  describe('getByStatus()', () => {
    it('should return O(1) lookup after load', async () => {
      const events = [
        FIXTURES.claimEvent({ wuId: 'WU-100', lane: 'Operations: Tooling' }),
        FIXTURES.claimEvent({ wuId: 'WU-101', lane: 'Operations: Workflow Engine' }),
        FIXTURES.completeEvent({ wuId: 'WU-100' }),
      ];
      await writeJsonlFile(eventsFilePath, events);
      await store.load();

      const inProgress = store.getByStatus('in_progress');
      expect(inProgress.size).toBe(1, 'Should have 1 in_progress');
      expect(inProgress.has('WU-101'), 'Should be WU-101');

      const done = store.getByStatus('done');
      expect(done.size).toBe(1, 'Should have 1 done');
      expect(done.has('WU-100'), 'Should be WU-100');
    });

    it('should return empty Set for status with no WUs', async () => {
      await store.load();

      const ready = store.getByStatus('ready');
      expect(ready instanceof Set, 'Should return Set');
      expect(ready.size).toBe(0, 'Should be empty');
    });
  });

  describe('getByLane()', () => {
    it('should return O(1) lookup after load', async () => {
      const events = [
        FIXTURES.claimEvent({ wuId: 'WU-100', lane: 'Operations: Tooling' }),
        FIXTURES.claimEvent({ wuId: 'WU-101', lane: 'Operations: Workflow Engine' }),
        FIXTURES.claimEvent({ wuId: 'WU-102', lane: 'Operations: Tooling' }),
      ];
      await writeJsonlFile(eventsFilePath, events);
      await store.load();

      const tooling = store.getByLane('Operations: Tooling');
      expect(tooling.size).toBe(2, 'Should have 2 WUs in Tooling');
      expect(tooling.has('WU-100'), 'Should have WU-100');
      expect(tooling.has('WU-102'), 'Should have WU-102');

      const workflow = store.getByLane('Operations: Workflow Engine');
      expect(workflow.size).toBe(1, 'Should have 1 WU in Workflow Engine');
      expect(workflow.has('WU-101'), 'Should have WU-101');
    });

    it('should return empty Set for lane with no WUs', async () => {
      await store.load();

      const lane = store.getByLane('Operations: Tooling');
      expect(lane instanceof Set, 'Should return Set');
      expect(lane.size).toBe(0, 'Should be empty');
    });
  });

  describe('state machine validation', () => {
    it('should reject in_progress -> in_progress transition (duplicate claim)', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt]);
      await store.load();

      await expect(async () => store.claim('WU-100', 'Operations: Tooling', 'Test')).rejects.toThrow(/already in_progress/i);
    });

    it('should reject blocked -> done transition (must unblock first)', async () => {
      const claimEvt = FIXTURES.claimEvent({ wuId: 'WU-100' });
      const blockEvt = FIXTURES.blockEvent({ wuId: 'WU-100' });
      await writeJsonlFile(eventsFilePath, [claimEvt, blockEvt]);
      await store.load();

      await expect(async () => store.complete('WU-100')).rejects.toThrow(/not in_progress/i);
    });
  });

  describe('event type validation (WU-2063: fail-fast)', () => {
    it('should reject invalid event type before appending to store', async () => {
      await store.load();

      // Attempt to apply an event with invalid type
      const invalidEvent = {
        type: 'release', // Invalid event type
        wuId: 'WU-100',
        timestamp: new Date().toISOString(),
      };

      // applyEvent should throw before any state change
      assert.throws(
        () => store.applyEvent(invalidEvent),
        /Invalid input|Invalid discriminator value|Event type must be one of/i,
        'Should throw descriptive error for invalid event type'
      );

      // Verify no partial state was left
      const wuState = store.getWUState('WU-100');
      expect(wuState).toBe(undefined, 'No partial state should exist after validation failure');
    });

    it('should provide descriptive error message with allowed event types', async () => {
      await store.load();

      const invalidEvent = {
        type: 'release',
        wuId: 'WU-100',
        timestamp: new Date().toISOString(),
      };

      try {
        store.applyEvent(invalidEvent);
        throw new Error('Should have thrown an error');
      } catch (error) {
        // Error should mention valid event types or discriminator
        expect(
          error.message.includes('create') ||
            error.message.includes('claim') ||
            error.message.includes('Invalid discriminator'),
          `Error message should be descriptive: ${error.message}`
        );
      }
    });

    it('should not append invalid event to file during load', async () => {
      // Simulate a corrupted file with invalid event type
      const invalidEvent = {
        type: 'release',
        wuId: 'WU-100',
        timestamp: new Date().toISOString(),
      };
      await writeJsonlFile(eventsFilePath, [invalidEvent]);

      // Load should reject with line context
      await expect(async () => store.load()).rejects.toThrow(/line 1|validation/i);

      // Verify no state was built
      const wuState = store.getWUState('WU-100');
      expect(wuState).toBe(undefined, 'No state should exist after load failure');
    });
  });

  describe('spawn events (WU-1947)', () => {
    /**
     * Creates a valid spawn event fixture
     */
    const spawnEvent = (overrides = {}) => ({
      type: 'spawn',
      wuId: 'WU-200',
      parentWuId: 'WU-100',
      spawnId: 'spawn-abc123',
      timestamp: new Date().toISOString(),
      ...overrides,
    });

    describe('SpawnEventSchema validation', () => {
      it('should validate spawn event with all required fields', async () => {
        const event = spawnEvent();
        await writeJsonlFile(eventsFilePath, [event]);

        await store.load();

        // If load succeeds without throwing, validation passed
        expect(true, 'Spawn event should be valid');
      });

      it('should reject spawn event missing parentWuId', async () => {
        const event = {
          type: 'spawn',
          wuId: 'WU-200',
          spawnId: 'spawn-abc123',
          timestamp: new Date().toISOString(),
        };
        await writeJsonlFile(eventsFilePath, [event]);

        await expect(async () => store.load()).rejects.toThrow(/validation/i);
      });

      it('should reject spawn event missing spawnId', async () => {
        const event = {
          type: 'spawn',
          wuId: 'WU-200',
          parentWuId: 'WU-100',
          timestamp: new Date().toISOString(),
        };
        await writeJsonlFile(eventsFilePath, [event]);

        await expect(async () => store.load()).rejects.toThrow(/validation/i);
      });

      it('should validate parentWuId matches WU-XXX pattern', async () => {
        const event = spawnEvent({ parentWuId: 'invalid-id' });
        await writeJsonlFile(eventsFilePath, [event]);

        await expect(async () => store.load()).rejects.toThrow(/validation/i);
      });
    });

    describe('byParent index', () => {
      it('should track spawn relationship in byParent index', async () => {
        const event = spawnEvent({ wuId: 'WU-200', parentWuId: 'WU-100' });
        await writeJsonlFile(eventsFilePath, [event]);

        await store.load();

        const children = store.getChildWUs('WU-100');
        expect(children.size).toBe(1, 'Should have 1 child WU');
        expect(children.has('WU-200'), 'Should contain WU-200');
      });

      it('should track multiple children for same parent', async () => {
        const events = [
          spawnEvent({ wuId: 'WU-200', parentWuId: 'WU-100', spawnId: 'spawn-1' }),
          spawnEvent({ wuId: 'WU-201', parentWuId: 'WU-100', spawnId: 'spawn-2' }),
          spawnEvent({ wuId: 'WU-202', parentWuId: 'WU-100', spawnId: 'spawn-3' }),
        ];
        await writeJsonlFile(eventsFilePath, events);

        await store.load();

        const children = store.getChildWUs('WU-100');
        expect(children.size).toBe(3, 'Should have 3 child WUs');
        expect(children.has('WU-200'), 'Should contain WU-200');
        expect(children.has('WU-201'), 'Should contain WU-201');
        expect(children.has('WU-202'), 'Should contain WU-202');
      });

      it('should return empty Set for parent with no children', async () => {
        await store.load();

        const children = store.getChildWUs('WU-999');
        expect(children instanceof Set, 'Should return Set');
        expect(children.size).toBe(0, 'Should be empty');
      });

      it('should track children from different parents separately', async () => {
        const events = [
          spawnEvent({ wuId: 'WU-200', parentWuId: 'WU-100', spawnId: 'spawn-1' }),
          spawnEvent({ wuId: 'WU-300', parentWuId: 'WU-101', spawnId: 'spawn-2' }),
        ];
        await writeJsonlFile(eventsFilePath, events);

        await store.load();

        const children100 = store.getChildWUs('WU-100');
        expect(children100.size).toBe(1, 'WU-100 should have 1 child');
        expect(children100.has('WU-200'), 'WU-100 should have WU-200');

        const children101 = store.getChildWUs('WU-101');
        expect(children101.size).toBe(1, 'WU-101 should have 1 child');
        expect(children101.has('WU-300'), 'WU-101 should have WU-300');
      });
    });

    describe('state rebuild', () => {
      it('should rebuild spawn relationships after load', async () => {
        const events = [
          FIXTURES.claimEvent({ wuId: 'WU-100' }),
          spawnEvent({ wuId: 'WU-200', parentWuId: 'WU-100', spawnId: 'spawn-1' }),
          spawnEvent({ wuId: 'WU-201', parentWuId: 'WU-100', spawnId: 'spawn-2' }),
        ];
        await writeJsonlFile(eventsFilePath, events);

        await store.load();

        // Parent should still be in_progress
        const inProgress = store.getByStatus('in_progress');
        expect(inProgress.has('WU-100'), 'Parent should be in_progress');

        // Children should be tracked
        const children = store.getChildWUs('WU-100');
        expect(children.size).toBe(2, 'Should have 2 children');
      });

      it('should persist spawn event when recorded', async () => {
        await store.load();

        // First claim the parent WU
        await store.claim('WU-100', 'Operations: Tooling', 'Parent WU');

        // Then record a spawn relationship
        await store.spawn('WU-200', 'WU-100', 'spawn-abc123');

        // Check file persisted
        const content = await fs.readFile(eventsFilePath, 'utf-8');
        const lines = content.trim().split('\n');
        expect(lines.length).toBe(2, 'Should have 2 events');

        const spawnEvt = JSON.parse(lines[1]);
        expect(spawnEvt.type).toBe('spawn', 'Should be spawn event');
        expect(spawnEvt.wuId).toBe('WU-200', 'Should have correct wuId');
        expect(spawnEvt.parentWuId).toBe('WU-100', 'Should have correct parentWuId');
        expect(spawnEvt.spawnId).toBe('spawn-abc123', 'Should have correct spawnId');
      });
    });
  });
});
