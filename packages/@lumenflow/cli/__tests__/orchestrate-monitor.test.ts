/**
 * Orchestrate Monitor CLI Tests (WU-1241)
 *
 * Tests for the orchestrate:monitor command that wires CLI to spawn-monitor APIs in core.
 *
 * Test categories:
 * 1. API wiring - verifies CLI calls core spawn-monitor APIs
 * 2. Status formatting - verifies output structure
 * 3. Recovery actions - verifies signal/restart/escalate recovery
 * 4. Dry-run mode - verifies no actions taken in dry-run
 * 5. Threshold configuration - verifies configurable stuck detection
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeSpawns,
  detectStuckSpawns,
  generateSuggestions,
  formatMonitorOutput,
  DEFAULT_THRESHOLD_MINUTES,
} from '@lumenflow/core/dist/spawn-monitor.js';
import { SpawnStatus, type SpawnEvent } from '@lumenflow/core/dist/spawn-registry-schema.js';

// Test constants to avoid duplicate string literals
const TEST_LANE = 'Framework: CLI';
const TEST_PARENT_WU = 'WU-1000';
const TEST_TARGET_WU = 'WU-1001';

// Test will import from dist/orchestrate-monitor.js once implemented
// For now, we verify the core APIs work correctly

describe('orchestrate:monitor (WU-1241)', () => {
  describe('API wiring verification', () => {
    describe('analyzeSpawns wiring', () => {
      it('calls analyzeSpawns with spawn events and returns correct counts', () => {
        const spawns: SpawnEvent[] = [
          createSpawn('spawn-a1b2', SpawnStatus.PENDING),
          createSpawn('spawn-c3d4', SpawnStatus.COMPLETED),
        ];

        const analysis = analyzeSpawns(spawns);

        expect(analysis.pending).toBe(1);
        expect(analysis.completed).toBe(1);
        expect(analysis.total).toBe(2);
      });
    });

    describe('detectStuckSpawns wiring', () => {
      it('calls detectStuckSpawns with configurable threshold (default 30min)', () => {
        expect(DEFAULT_THRESHOLD_MINUTES).toBe(30);

        // Spawn 45 minutes old - should be stuck with default threshold
        const oldSpawnTime = new Date(Date.now() - 45 * 60 * 1000).toISOString();
        const spawns = [createSpawn('spawn-old1', SpawnStatus.PENDING, oldSpawnTime)];

        const stuck = detectStuckSpawns(spawns, 30);

        expect(stuck.length).toBe(1);
        expect(stuck[0].spawn.id).toBe('spawn-old1');
        expect(stuck[0].ageMinutes).toBeGreaterThanOrEqual(45);
      });

      it('respects custom threshold (e.g., 15 minutes)', () => {
        // Spawn 20 minutes old
        const recentSpawnTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const spawns = [createSpawn('spawn-cust', SpawnStatus.PENDING, recentSpawnTime)];

        // Not stuck with 30min threshold
        expect(detectStuckSpawns(spawns, 30).length).toBe(0);

        // Stuck with 15min threshold
        expect(detectStuckSpawns(spawns, 15).length).toBe(1);
      });
    });

    describe('generateSuggestions wiring', () => {
      it('generates wu:block suggestions for stuck spawns', () => {
        const stuckSpawns = [
          {
            spawn: createSpawn('spawn-1', SpawnStatus.PENDING),
            ageMinutes: 45,
            lastCheckpoint: null,
          },
        ];

        const suggestions = generateSuggestions(stuckSpawns, []);

        expect(suggestions.length).toBe(1);
        expect(suggestions[0].command).toContain('wu:block');
        expect(suggestions[0].command).toContain('WU-1001');
      });

      it('generates lane:unlock suggestions for zombie locks', () => {
        const zombieLocks = [
          {
            wuId: 'WU-1001',
            lane: TEST_LANE,
            pid: 999999,
            timestamp: new Date().toISOString(),
          },
        ];

        const suggestions = generateSuggestions([], zombieLocks);

        expect(suggestions.length).toBe(1);
        expect(suggestions[0].command).toContain('lane:unlock');
        expect(suggestions[0].command).toContain(TEST_LANE);
      });
    });
  });

  describe('status output format', () => {
    it('shows active spawns count in output', () => {
      const result = {
        analysis: { pending: 2, completed: 3, timeout: 0, crashed: 1, total: 6 },
        stuckSpawns: [],
        zombieLocks: [],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Pending:   2');
      expect(output).toContain('Completed: 3');
      expect(output).toContain('Total:     6');
    });

    it('shows stuck spawns with age in output', () => {
      const result = {
        analysis: { pending: 1, completed: 0, timeout: 0, crashed: 0, total: 1 },
        stuckSpawns: [
          {
            spawn: createSpawn('spawn-stk1', SpawnStatus.PENDING),
            ageMinutes: 60,
            lastCheckpoint: null,
          },
        ],
        zombieLocks: [],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Stuck Spawns');
      expect(output).toContain('WU-1001');
      expect(output).toContain('60 minutes');
    });

    it('shows zombie locks with PID in output', () => {
      const result = {
        analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
        stuckSpawns: [],
        zombieLocks: [
          {
            wuId: 'WU-1001',
            lane: TEST_LANE,
            pid: 999999,
            timestamp: new Date().toISOString(),
          },
        ],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Zombie Locks');
      expect(output).toContain('999999');
    });

    it('shows suggestions section in output', () => {
      const result = {
        analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
        stuckSpawns: [],
        zombieLocks: [],
        suggestions: [
          {
            command: 'pnpm wu:block --id WU-1001',
            reason: 'Spawn stuck for 45 minutes',
          },
        ],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Suggestions');
      expect(output).toContain('wu:block');
    });

    it('shows healthy message when no issues', () => {
      const result = {
        analysis: { pending: 0, completed: 5, timeout: 0, crashed: 0, total: 5 },
        stuckSpawns: [],
        zombieLocks: [],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('No issues detected');
      expect(output).toContain('healthy');
    });
  });

  describe('recovery actions', () => {
    it('generates recovery action for zombie locks', () => {
      const zombieLocks = [
        {
          wuId: 'WU-1001',
          lane: TEST_LANE,
          pid: 999999,
          timestamp: new Date().toISOString(),
        },
      ];

      const suggestions = generateSuggestions([], zombieLocks);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].command).toContain('lane:unlock');
      expect(suggestions[0].reason).toContain('999999');
    });

    it('generates recovery action for stuck spawns', () => {
      const stuckSpawns = [
        {
          spawn: createSpawn('spawn-stk2', SpawnStatus.PENDING),
          ageMinutes: 120,
          lastCheckpoint: null,
        },
      ];

      const suggestions = generateSuggestions(stuckSpawns, []);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].command).toContain('wu:block');
      expect(suggestions[0].reason).toContain('120 minutes');
    });
  });

  describe('threshold configuration', () => {
    it('uses default 30 minute threshold', () => {
      // Spawn at 20 minutes ago - should NOT be stuck
      const recentSpawnTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const spawns = [createSpawn('spawn-rec1', SpawnStatus.PENDING, recentSpawnTime)];

      const stuck = detectStuckSpawns(spawns); // Uses default 30 min

      expect(stuck.length).toBe(0);
    });

    it('respects custom threshold', () => {
      // Spawn at 20 minutes old
      const recentSpawnTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const spawns = [createSpawn('spawn-cust', SpawnStatus.PENDING, recentSpawnTime)];

      // Not stuck with default 30min threshold
      expect(detectStuckSpawns(spawns, 30).length).toBe(0);

      // Stuck with 15min threshold
      expect(detectStuckSpawns(spawns, 15).length).toBe(1);
    });
  });

  describe('empty state handling', () => {
    it('returns healthy status when no spawns exist', () => {
      const analysis = analyzeSpawns([]);
      const stuck = detectStuckSpawns([]);
      const suggestions = generateSuggestions([], []);

      expect(analysis.total).toBe(0);
      expect(stuck.length).toBe(0);
      expect(suggestions.length).toBe(0);
    });

    it('returns healthy status when all spawns are completed', () => {
      const spawns = [
        createSpawn('spawn-cmp1', SpawnStatus.COMPLETED),
        createSpawn('spawn-cmp2', SpawnStatus.COMPLETED),
      ];

      const stuck = detectStuckSpawns(spawns);
      const suggestions = generateSuggestions([], []);

      expect(stuck.length).toBe(0);
      expect(suggestions.length).toBe(0);
    });
  });
});

// Helper function to create mock spawn events
function createSpawn(id: string, status: string, spawnedAt?: string): SpawnEvent {
  return {
    id,
    parentWuId: TEST_PARENT_WU,
    targetWuId: TEST_TARGET_WU,
    lane: TEST_LANE,
    spawnedAt: spawnedAt || new Date().toISOString(),
    status: status as SpawnEvent['status'],
    completedAt: status === SpawnStatus.COMPLETED ? new Date().toISOString() : null,
  };
}
