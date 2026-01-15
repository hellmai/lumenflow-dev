/**
 * Spawn Registry Store Tests (WU-2539)
 *
 * Tests for event-sourced spawn registry storage.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SpawnRegistryStore,
  SPAWN_REGISTRY_FILE_NAME,
} from '../../src/spawn/spawn-registry-store.js';
import { SpawnStatus } from '../../src/spawn/spawn-registry-schema.js';

describe('SpawnRegistryStore', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'spawn-registry-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('initializes with empty state', () => {
      const store = new SpawnRegistryStore(tempDir);
      expect(store.spawns.size).toBe(0);
      expect(store.byParent.size).toBe(0);
      expect(store.byTarget.size).toBe(0);
    });
  });

  describe('load', () => {
    it('returns empty state when file does not exist', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();
      expect(store.spawns.size).toBe(0);
    });

    it('throws on malformed JSON', async () => {
      const filePath = join(tempDir, SPAWN_REGISTRY_FILE_NAME);
      await writeFile(filePath, 'not valid json\n');
      const store = new SpawnRegistryStore(tempDir);
      await expect(store.load()).rejects.toThrow('Malformed JSON');
    });

    it('throws on invalid event schema', async () => {
      const filePath = join(tempDir, SPAWN_REGISTRY_FILE_NAME);
      const invalidEvent = JSON.stringify({ invalid: 'event' });
      await writeFile(filePath, invalidEvent + '\n');
      const store = new SpawnRegistryStore(tempDir);
      await expect(store.load()).rejects.toThrow('Validation error');
    });

    it('skips empty lines', async () => {
      const filePath = join(tempDir, SPAWN_REGISTRY_FILE_NAME);
      const validEvent = JSON.stringify({
        id: 'spawn-a1b2',
        parentWuId: 'WU-1000',
        targetWuId: 'WU-1001',
        lane: 'Operations: Tooling',
        spawnedAt: '2025-01-15T10:00:00.000Z',
        status: 'pending',
        completedAt: null,
      });
      await writeFile(filePath, '\n' + validEvent + '\n\n');
      const store = new SpawnRegistryStore(tempDir);
      await store.load();
      expect(store.spawns.size).toBe(1);
    });
  });

  describe('record', () => {
    it('creates spawn event with pending status', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      const spawnId = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');

      expect(spawnId).toMatch(/^spawn-[0-9a-f]{4}$/);
      expect(store.spawns.has(spawnId)).toBe(true);

      const spawn = store.spawns.get(spawnId);
      expect(spawn?.status).toBe(SpawnStatus.PENDING);
      expect(spawn?.parentWuId).toBe('WU-1000');
      expect(spawn?.targetWuId).toBe('WU-1001');
    });

    it('persists to file', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');

      const filePath = join(tempDir, SPAWN_REGISTRY_FILE_NAME);
      const content = await readFile(filePath, 'utf-8');
      expect(content).toContain('WU-1000');
      expect(content).toContain('WU-1001');
    });

    it('updates indexes', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      const spawnId = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');

      expect(store.byParent.get('WU-1000')).toContain(spawnId);
      expect(store.byTarget.get('WU-1001')).toBe(spawnId);
    });
  });

  describe('updateStatus', () => {
    it('updates spawn status', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      const spawnId = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');
      await store.updateStatus(spawnId, SpawnStatus.COMPLETED);

      const spawn = store.spawns.get(spawnId);
      expect(spawn?.status).toBe(SpawnStatus.COMPLETED);
      expect(spawn?.completedAt).not.toBeNull();
    });

    it('throws for unknown spawn ID', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      await expect(store.updateStatus('spawn-xxxx', SpawnStatus.COMPLETED)).rejects.toThrow(
        'not found',
      );
    });

    it('appends new event to file', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      const spawnId = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');
      await store.updateStatus(spawnId, SpawnStatus.COMPLETED);

      const filePath = join(tempDir, SPAWN_REGISTRY_FILE_NAME);
      const content = await readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');
      expect(lines.length).toBe(2); // Initial record + status update
    });
  });

  describe('getByParent', () => {
    it('returns empty array when no spawns', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      const spawns = store.getByParent('WU-1000');
      expect(spawns).toEqual([]);
    });

    it('returns all spawns for parent', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');
      await store.record('WU-1000', 'WU-1002', 'Core: Backend');

      const spawns = store.getByParent('WU-1000');
      expect(spawns.length).toBe(2);
    });

    it('does not return spawns from other parents', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');
      await store.record('WU-2000', 'WU-2001', 'Core: Backend');

      const spawns = store.getByParent('WU-1000');
      expect(spawns.length).toBe(1);
      expect(spawns[0]?.targetWuId).toBe('WU-1001');
    });
  });

  describe('getByTarget', () => {
    it('returns null when no spawn for target', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      const spawn = store.getByTarget('WU-1001');
      expect(spawn).toBeNull();
    });

    it('returns spawn for target', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');

      const spawn = store.getByTarget('WU-1001');
      expect(spawn?.parentWuId).toBe('WU-1000');
    });
  });

  describe('getPending', () => {
    it('returns empty array when no spawns', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      const pending = store.getPending();
      expect(pending).toEqual([]);
    });

    it('returns only pending spawns', async () => {
      const store = new SpawnRegistryStore(tempDir);
      await store.load();

      const spawnId1 = await store.record('WU-1000', 'WU-1001', 'Operations: Tooling');
      await store.record('WU-1000', 'WU-1002', 'Core: Backend');
      await store.updateStatus(spawnId1, SpawnStatus.COMPLETED);

      const pending = store.getPending();
      expect(pending.length).toBe(1);
      expect(pending[0]?.targetWuId).toBe('WU-1002');
    });
  });

  describe('event replay', () => {
    it('reconstructs state from multiple events', async () => {
      // First session: create and update
      const store1 = new SpawnRegistryStore(tempDir);
      await store1.load();
      const spawnId = await store1.record('WU-1000', 'WU-1001', 'Operations: Tooling');
      await store1.updateStatus(spawnId, SpawnStatus.COMPLETED);

      // Second session: load and verify
      const store2 = new SpawnRegistryStore(tempDir);
      await store2.load();

      expect(store2.spawns.size).toBe(1);
      const spawn = store2.spawns.get(spawnId);
      expect(spawn?.status).toBe(SpawnStatus.COMPLETED);
    });
  });
});
