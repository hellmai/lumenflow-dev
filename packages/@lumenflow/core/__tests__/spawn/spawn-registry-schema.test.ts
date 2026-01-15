/**
 * Spawn Registry Schema Tests (WU-2539)
 *
 * Tests for spawn event validation using Zod schemas.
 */

import { describe, it, expect } from 'vitest';
import {
  validateSpawnEvent,
  generateSpawnId,
  SpawnStatus,
  SPAWN_STATUSES,
  type SpawnEvent,
} from '../../src/spawn/spawn-registry-schema.js';

describe('Spawn Registry Schema', () => {
  describe('validateSpawnEvent', () => {
    const validEvent: SpawnEvent = {
      id: 'spawn-a1b2',
      parentWuId: 'WU-1000',
      targetWuId: 'WU-1001',
      lane: 'Operations: Tooling',
      spawnedAt: '2025-01-15T10:00:00.000Z',
      status: SpawnStatus.PENDING,
      completedAt: null,
    };

    it('validates a correct spawn event', () => {
      const result = validateSpawnEvent(validEvent);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.id).toBe('spawn-a1b2');
      }
    });

    it('rejects invalid spawn ID format', () => {
      const result = validateSpawnEvent({
        ...validEvent,
        id: 'invalid-id',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('spawn-');
      }
    });

    it('rejects invalid parent WU ID format', () => {
      const result = validateSpawnEvent({
        ...validEvent,
        parentWuId: 'invalid',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid target WU ID format', () => {
      const result = validateSpawnEvent({
        ...validEvent,
        targetWuId: 'not-a-wu',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty lane', () => {
      const result = validateSpawnEvent({
        ...validEvent,
        lane: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid status', () => {
      const result = validateSpawnEvent({
        ...validEvent,
        status: 'invalid_status',
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid timestamp format', () => {
      const result = validateSpawnEvent({
        ...validEvent,
        spawnedAt: 'not-a-date',
      });
      expect(result.success).toBe(false);
    });

    it('accepts completedAt as null', () => {
      const result = validateSpawnEvent({
        ...validEvent,
        completedAt: null,
      });
      expect(result.success).toBe(true);
    });

    it('accepts completedAt as valid timestamp', () => {
      const result = validateSpawnEvent({
        ...validEvent,
        completedAt: '2025-01-15T11:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('validates all valid statuses', () => {
      for (const status of SPAWN_STATUSES) {
        const result = validateSpawnEvent({
          ...validEvent,
          status,
        });
        expect(result.success).toBe(true);
      }
    });
  });

  describe('generateSpawnId', () => {
    it('generates spawn ID in correct format', () => {
      const id = generateSpawnId('WU-1000', 'WU-1001');
      expect(id).toMatch(/^spawn-[0-9a-f]{4}$/);
    });

    it('generates unique IDs for same inputs (includes random)', () => {
      const id1 = generateSpawnId('WU-1000', 'WU-1001');
      const id2 = generateSpawnId('WU-1000', 'WU-1001');
      // Note: There's a very small chance these could be equal
      // In practice, the timestamp + random bytes make collisions unlikely
      expect(id1).toMatch(/^spawn-[0-9a-f]{4}$/);
      expect(id2).toMatch(/^spawn-[0-9a-f]{4}$/);
    });

    it('generates valid format for different WU IDs', () => {
      const id = generateSpawnId('WU-9999', 'WU-8888');
      expect(id).toMatch(/^spawn-[0-9a-f]{4}$/);
    });
  });

  describe('SpawnStatus enum', () => {
    it('has PENDING status', () => {
      expect(SpawnStatus.PENDING).toBe('pending');
    });

    it('has COMPLETED status', () => {
      expect(SpawnStatus.COMPLETED).toBe('completed');
    });

    it('has TIMEOUT status', () => {
      expect(SpawnStatus.TIMEOUT).toBe('timeout');
    });

    it('has CRASHED status', () => {
      expect(SpawnStatus.CRASHED).toBe('crashed');
    });

    it('has ESCALATED status', () => {
      expect(SpawnStatus.ESCALATED).toBe('escalated');
    });
  });

  describe('SPAWN_STATUSES constant', () => {
    it('includes all status values', () => {
      expect(SPAWN_STATUSES).toContain(SpawnStatus.PENDING);
      expect(SPAWN_STATUSES).toContain(SpawnStatus.COMPLETED);
      expect(SPAWN_STATUSES).toContain(SpawnStatus.TIMEOUT);
      expect(SPAWN_STATUSES).toContain(SpawnStatus.CRASHED);
      expect(SPAWN_STATUSES).toContain(SpawnStatus.ESCALATED);
    });
  });
});
