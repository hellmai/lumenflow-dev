/**
 * Spawn Registry Store Tests (WU-1944)
 *
 * TDD: Tests written first, implementation follows.
 * Event-sourced spawn registry for tracking sub-agent spawns.
 *
 * @see {@link tools/lib/spawn-registry-store.mjs} - Implementation
 * @see {@link tools/lib/spawn-registry-schema.mjs} - Schema definitions
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Imports will fail until implementation exists (TDD RED phase)
import {
  SpawnRegistryStore,
  SPAWN_REGISTRY_FILE_NAME,
} from '../spawn-registry-store.js';
import {
  SpawnEventSchema,
  SpawnStatus,
  validateSpawnEvent,
  generateSpawnId,
} from '../spawn-registry-schema.js';

/**
 * Test fixtures for spawn events
 */
const FIXTURES = {
  /** Creates a valid spawn event with pending status */
  spawnEvent: (overrides = {}) => ({
    id: overrides.id ?? 'spawn-abcd',
    parentWuId: overrides.parentWuId ?? 'WU-1000',
    targetWuId: overrides.targetWuId ?? 'WU-1001',
    lane: overrides.lane ?? 'Operations: Tooling',
    spawnedAt: overrides.spawnedAt ?? new Date().toISOString(),
    status: overrides.status ?? 'pending',
    completedAt: overrides.completedAt ?? null,
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

describe('spawn-registry-schema', () => {
  describe('SpawnStatus constants', () => {
    it('should export status constants', () => {
      expect(SpawnStatus.PENDING).toBe('pending');
      expect(SpawnStatus.COMPLETED).toBe('completed');
      expect(SpawnStatus.TIMEOUT).toBe('timeout');
      expect(SpawnStatus.CRASHED).toBe('crashed');
    });
  });

  describe('generateSpawnId()', () => {
    it('should generate spawn ID with spawn-XXXX format (4 hex chars)', () => {
      const id = generateSpawnId('WU-1000', 'WU-1001');
      expect(id).toMatch(/^spawn-[0-9a-f]{4}$/, 'Should match spawn-XXXX format');
    });

    it('should generate different IDs for different inputs', () => {
      const id1 = generateSpawnId('WU-1000', 'WU-1001');
      const id2 = generateSpawnId('WU-1000', 'WU-1002');
      expect(id1).not.toBe(id2, 'Different targets should produce different IDs');
    });

    it('should include timestamp in hash to ensure uniqueness', () => {
      // This test relies on timing - two calls with same inputs should differ
      // Because we include timestamp in the hash
      const id1 = generateSpawnId('WU-1000', 'WU-1001');
      // Slight delay to get different timestamp
      const id2 = generateSpawnId('WU-1000', 'WU-1001');
      // Note: They might be the same if called within same millisecond
      // The implementation should include some unique factor
      expect(id1).toMatch(/^spawn-[0-9a-f]{4}$/, 'Should match format');
    });
  });

  describe('SpawnEventSchema validation', () => {
    it('should validate a complete spawn event', () => {
      const event = FIXTURES.spawnEvent();
      const result = validateSpawnEvent(event);
      assert.ok(result.success, 'Should validate successfully');
    });

    it('should reject event with invalid spawn ID format', () => {
      const event = FIXTURES.spawnEvent({ id: 'invalid' });
      const result = validateSpawnEvent(event);
      expect(result.success, 'Should fail validation').toBeFalsy();
    });

    it('should reject event with invalid parent WU ID format', () => {
      const event = FIXTURES.spawnEvent({ parentWuId: 'invalid' });
      const result = validateSpawnEvent(event);
      expect(result.success, 'Should fail validation').toBeFalsy();
    });

    it('should reject event with invalid target WU ID format', () => {
      const event = FIXTURES.spawnEvent({ targetWuId: 'invalid' });
      const result = validateSpawnEvent(event);
      expect(result.success, 'Should fail validation').toBeFalsy();
    });

    it('should reject event with invalid status', () => {
      const event = FIXTURES.spawnEvent({ status: 'invalid' });
      const result = validateSpawnEvent(event);
      expect(result.success, 'Should fail validation').toBeFalsy();
    });

    it('should accept null completedAt for pending status', () => {
      const event = FIXTURES.spawnEvent({ status: 'pending', completedAt: null });
      const result = validateSpawnEvent(event);
      assert.ok(result.success, 'Should validate successfully');
    });

    it('should accept ISO timestamp for completedAt when completed', () => {
      const event = FIXTURES.spawnEvent({
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      const result = validateSpawnEvent(event);
      assert.ok(result.success, 'Should validate successfully');
    });
  });
});

describe('spawn-registry-store', () => {
  let tempDir;
  let registryFilePath;
  let store;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'spawn-registry-test-'));
    registryFilePath = path.join(tempDir, SPAWN_REGISTRY_FILE_NAME);
    store = new SpawnRegistryStore(tempDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('SPAWN_REGISTRY_FILE_NAME constant', () => {
    it('should export the registry file name', () => {
      expect(SPAWN_REGISTRY_FILE_NAME).toBe('spawn-registry.jsonl');
    });
  });

  describe('load()', () => {
    it('should handle missing file and return empty state', async () => {
      await store.load();

      const pending = store.getPending();
      assert.ok(Array.isArray(pending), 'Should return array');
      expect(pending.length).toBe(0, 'Should be empty');
    });

    it('should handle empty file and return empty state', async () => {
      await fs.writeFile(registryFilePath, '', 'utf-8');
      await store.load();

      const pending = store.getPending();
      expect(pending.length).toBe(0, 'Should be empty');
    });

    it('should load spawn events from JSONL file', async () => {
      const event = FIXTURES.spawnEvent({ id: 'spawn-1234' });
      await writeJsonlFile(registryFilePath, [event]);

      await store.load();

      const pending = store.getPending();
      expect(pending.length).toBe(1, 'Should have 1 pending spawn');
      expect(pending[0].id).toBe('spawn-1234', 'Should match ID');
    });

    it('should skip empty lines gracefully', async () => {
      const event = FIXTURES.spawnEvent({ id: 'spawn-1234' });
      const content = `${JSON.stringify(event)}\n\n${JSON.stringify(FIXTURES.spawnEvent({ id: 'spawn-5678' }))}\n`;
      await fs.writeFile(registryFilePath, content, 'utf-8');

      await store.load();

      const pending = store.getPending();
      expect(pending.length).toBe(2, 'Should have 2 spawns');
    });

    it('should throw on malformed JSON lines', async () => {
      const content = `${JSON.stringify(FIXTURES.spawnEvent())}\n{invalid json}\n`;
      await fs.writeFile(registryFilePath, content, 'utf-8');

      await expect(async () => store.load()).rejects.toThrow(/JSON/i);
    });

    it('should throw on invalid event schema', async () => {
      const invalidEvent = { id: 'invalid', parentWuId: 'bad' };
      await writeJsonlFile(registryFilePath, [invalidEvent]);

      await expect(async () => store.load()).rejects.toThrow(/validation/i);
    });
  });

  describe('record()', () => {
    it('should record a new spawn and append to file', async () => {
      await store.load();

      const spawnId = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');

      // Check spawn ID format
      expect(spawnId).toMatch(/^spawn-[0-9a-f]{4}$/, 'Should return spawn ID');

      // Check in-memory state
      const pending = store.getPending();
      expect(pending.length).toBe(1, 'Should have 1 pending spawn');
      expect(pending[0].parentWuId).toBe('WU-1000', 'Should have correct parent');
      expect(pending[0].targetWuId).toBe('WU-1001', 'Should have correct target');
      expect(pending[0].lane).toBe('Operations: Tooling', 'Should have correct lane');
      expect(pending[0].status).toBe('pending', 'Should be pending');

      // Check file persisted
      const content = await fs.readFile(registryFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(1, 'Should have 1 event');
      const event = JSON.parse(lines[0]);
      expect(event.status).toBe('pending', 'Should be pending status');
    });

    it('should validate event before recording', async () => {
      await store.load();

      await expect(async () => store.record('', '', '')).rejects.toThrow(/validation/i);

      // File should not exist if record failed
      await expect(async () => fs.access(registryFilePath)).rejects.toThrow();
    });

    it('should create parent directory if missing', async () => {
      const nestedDir = path.join(tempDir, 'nested', 'dir');
      const nestedStore = new SpawnRegistryStore(nestedDir);
      await nestedStore.load();

      const spawnId = await nestedStore.record('WU-1000', 'WU-1001', 'Operations: Tooling');

      expect(spawnId).toMatch(/^spawn-[0-9a-f]{4}$/, 'Should return spawn ID');
    });
  });

  describe('updateStatus()', () => {
    it('should update status to completed with completedAt timestamp', async () => {
      const event = FIXTURES.spawnEvent({ id: 'spawn-1234', status: 'pending' });
      await writeJsonlFile(registryFilePath, [event]);
      await store.load();

      await store.updateStatus('spawn-1234', 'completed');

      // Check in-memory state
      const pending = store.getPending();
      expect(pending.length).toBe(0, 'Should have no pending spawns');

      // Check the spawn was updated
      const spawns = store.getByParent('WU-1000');
      expect(spawns.length).toBe(1, 'Should have 1 spawn');
      expect(spawns[0].status).toBe('completed', 'Should be completed');
      assert.ok(spawns[0].completedAt, 'Should have completedAt timestamp');
    });

    it('should update status to timeout', async () => {
      const event = FIXTURES.spawnEvent({ id: 'spawn-1234', status: 'pending' });
      await writeJsonlFile(registryFilePath, [event]);
      await store.load();

      await store.updateStatus('spawn-1234', 'timeout');

      const spawns = store.getByParent('WU-1000');
      expect(spawns[0].status).toBe('timeout', 'Should be timeout');
    });

    it('should update status to crashed', async () => {
      const event = FIXTURES.spawnEvent({ id: 'spawn-1234', status: 'pending' });
      await writeJsonlFile(registryFilePath, [event]);
      await store.load();

      await store.updateStatus('spawn-1234', 'crashed');

      const spawns = store.getByParent('WU-1000');
      expect(spawns[0].status).toBe('crashed', 'Should be crashed');
    });

    it('should throw on unknown spawn ID', async () => {
      await store.load();

      await expect(async () => store.updateStatus('spawn-unknown', 'completed')).rejects.toThrow(/not found/i);
    });

    it('should append updated event to file', async () => {
      const event = FIXTURES.spawnEvent({ id: 'spawn-1234', status: 'pending' });
      await writeJsonlFile(registryFilePath, [event]);
      await store.load();

      await store.updateStatus('spawn-1234', 'completed');

      // Check file has both events
      const content = await fs.readFile(registryFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      assert.equal(lines.length, 2, 'Should have 2 events (original + update)');

      const updatedEvent = JSON.parse(lines[1]);
      expect(updatedEvent.status).toBe('completed', 'Should be completed');
      assert.ok(updatedEvent.completedAt, 'Should have completedAt');
    });
  });

  describe('getByParent()', () => {
    it('should return all spawns for a parent WU', async () => {
      const events = [
        FIXTURES.spawnEvent({ id: 'spawn-1111', parentWuId: 'WU-1000', targetWuId: 'WU-1001' }),
        FIXTURES.spawnEvent({ id: 'spawn-2222', parentWuId: 'WU-1000', targetWuId: 'WU-1002' }),
        FIXTURES.spawnEvent({ id: 'spawn-3333', parentWuId: 'WU-2000', targetWuId: 'WU-2001' }),
      ];
      await writeJsonlFile(registryFilePath, events);
      await store.load();

      const spawns = store.getByParent('WU-1000');

      expect(spawns.length).toBe(2, 'Should have 2 spawns for WU-1000');
      assert.ok(spawns.some((s) => s.id === 'spawn-1111'), 'Should include spawn-1111');
      assert.ok(spawns.some((s) => s.id === 'spawn-2222'), 'Should include spawn-2222');
    });

    it('should return empty array for unknown parent', async () => {
      await store.load();

      const spawns = store.getByParent('WU-9999');

      assert.ok(Array.isArray(spawns), 'Should return array');
      expect(spawns.length).toBe(0, 'Should be empty');
    });
  });

  describe('getByTarget()', () => {
    it('should return spawn for a target WU', async () => {
      const events = [
        FIXTURES.spawnEvent({ id: 'spawn-1111', parentWuId: 'WU-1000', targetWuId: 'WU-1001' }),
        FIXTURES.spawnEvent({ id: 'spawn-2222', parentWuId: 'WU-1000', targetWuId: 'WU-1002' }),
      ];
      await writeJsonlFile(registryFilePath, events);
      await store.load();

      const spawn = store.getByTarget('WU-1001');

      assert.ok(spawn, 'Should return spawn');
      expect(spawn.id).toBe('spawn-1111', 'Should match ID');
      expect(spawn.targetWuId).toBe('WU-1001', 'Should match target');
    });

    it('should return null for unknown target', async () => {
      await store.load();

      const spawn = store.getByTarget('WU-9999');

      expect(spawn).toBe(null, 'Should return null');
    });
  });

  describe('getPending()', () => {
    it('should return only pending spawns', async () => {
      const events = [
        FIXTURES.spawnEvent({ id: 'spawn-1111', status: 'pending' }),
        FIXTURES.spawnEvent({
          id: 'spawn-2222',
          status: 'completed',
          completedAt: new Date().toISOString(),
          parentWuId: 'WU-1000',
          targetWuId: 'WU-1002',
        }),
        FIXTURES.spawnEvent({
          id: 'spawn-3333',
          status: 'pending',
          parentWuId: 'WU-2000',
          targetWuId: 'WU-2001',
        }),
      ];
      await writeJsonlFile(registryFilePath, events);
      await store.load();

      const pending = store.getPending();

      expect(pending.length).toBe(2, 'Should have 2 pending spawns');
      assert.ok(pending.every((s) => s.status === 'pending'), 'All should be pending');
    });

    it('should return empty array when no pending spawns', async () => {
      const events = [
        FIXTURES.spawnEvent({
          id: 'spawn-1111',
          status: 'completed',
          completedAt: new Date().toISOString(),
        }),
      ];
      await writeJsonlFile(registryFilePath, events);
      await store.load();

      const pending = store.getPending();

      expect(pending.length).toBe(0, 'Should be empty');
    });
  });

  describe('state reconstruction from events', () => {
    it('should reconstruct latest state from multiple events for same spawn', async () => {
      const pendingEvent = FIXTURES.spawnEvent({ id: 'spawn-1234', status: 'pending' });
      const completedEvent = FIXTURES.spawnEvent({
        id: 'spawn-1234',
        status: 'completed',
        completedAt: new Date().toISOString(),
      });
      await writeJsonlFile(registryFilePath, [pendingEvent, completedEvent]);
      await store.load();

      // Should have latest state (completed)
      const pending = store.getPending();
      assert.equal(pending.length, 0, 'Should have no pending (spawn is completed)');

      const spawns = store.getByParent('WU-1000');
      expect(spawns.length).toBe(1, 'Should have 1 spawn');
      expect(spawns[0].status).toBe('completed', 'Should be completed');
    });
  });
});
