/**
 * Spawn Monitor Core API Tests (WU-1241)
 *
 * Tests for the spawn-monitor library in @lumenflow/core.
 * These tests verify the core monitoring logic used by orchestrate:monitor CLI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import {
  analyzeSpawns,
  detectStuckSpawns,
  generateSuggestions,
  formatMonitorOutput,
  formatRecoveryResults,
  checkZombieLocks,
  DEFAULT_THRESHOLD_MINUTES,
  LOG_PREFIX,
} from '../spawn-monitor.js';
import { LUMENFLOW_PATHS } from '../wu-constants.js';
import { type SpawnEvent } from '../spawn-registry-schema.js';

// Test constants to avoid duplicate string literals
const TEST_LANE = 'Framework: CLI';
const TEST_PARENT_WU = 'WU-1000';
const TEST_TARGET_WU = 'WU-1001';

describe('spawn-monitor core APIs (WU-1241)', () => {
  describe('analyzeSpawns', () => {
    it('counts spawns by status correctly', () => {
      const spawns: SpawnEvent[] = [
        createSpawn('spawn-a', 'pending'),
        createSpawn('spawn-b', 'pending'),
        createSpawn('spawn-c', 'completed'),
        createSpawn('spawn-d', 'timeout'),
        createSpawn('spawn-e', 'crashed'),
      ];

      const analysis = analyzeSpawns(spawns);

      expect(analysis.pending).toBe(2);
      expect(analysis.completed).toBe(1);
      expect(analysis.timeout).toBe(1);
      expect(analysis.crashed).toBe(1);
      expect(analysis.total).toBe(5);
    });

    it('returns zero counts for empty array', () => {
      const analysis = analyzeSpawns([]);

      expect(analysis.pending).toBe(0);
      expect(analysis.completed).toBe(0);
      expect(analysis.timeout).toBe(0);
      expect(analysis.crashed).toBe(0);
      expect(analysis.total).toBe(0);
    });
  });

  describe('detectStuckSpawns', () => {
    it('uses default threshold of 30 minutes', () => {
      expect(DEFAULT_THRESHOLD_MINUTES).toBe(30);
    });

    it('detects pending spawns older than threshold', () => {
      const oldSpawnTime = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      const spawns = [createSpawn('spawn-old', 'pending', oldSpawnTime)];

      const stuck = detectStuckSpawns(spawns, 30);

      expect(stuck.length).toBe(1);
      expect(stuck[0].spawn.id).toBe('spawn-old');
      expect(stuck[0].ageMinutes).toBeGreaterThanOrEqual(45);
    });

    it('ignores pending spawns within threshold', () => {
      const recentSpawnTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const spawns = [createSpawn('spawn-recent', 'pending', recentSpawnTime)];

      const stuck = detectStuckSpawns(spawns, 30);

      expect(stuck.length).toBe(0);
    });

    it('ignores completed spawns regardless of age', () => {
      const oldSpawnTime = new Date(Date.now() - 120 * 60 * 1000).toISOString();
      const spawns = [createSpawn('spawn-done', 'completed', oldSpawnTime)];

      const stuck = detectStuckSpawns(spawns, 30);

      expect(stuck.length).toBe(0);
    });

    it('sorts stuck spawns by age descending (oldest first)', () => {
      const spawns = [
        createSpawn('spawn-30', 'pending', new Date(Date.now() - 35 * 60 * 1000).toISOString()),
        createSpawn('spawn-60', 'pending', new Date(Date.now() - 65 * 60 * 1000).toISOString()),
        createSpawn('spawn-45', 'pending', new Date(Date.now() - 50 * 60 * 1000).toISOString()),
      ];

      const stuck = detectStuckSpawns(spawns, 30);

      expect(stuck.length).toBe(3);
      expect(stuck[0].spawn.id).toBe('spawn-60'); // Oldest first
      expect(stuck[1].spawn.id).toBe('spawn-45');
      expect(stuck[2].spawn.id).toBe('spawn-30');
    });

    it('respects custom threshold', () => {
      const spawnTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const spawns = [createSpawn('spawn-custom', 'pending', spawnTime)];

      // With 30min threshold, not stuck
      expect(detectStuckSpawns(spawns, 30).length).toBe(0);

      // With 15min threshold, stuck
      expect(detectStuckSpawns(spawns, 15).length).toBe(1);
    });
  });

  describe('generateSuggestions', () => {
    it('generates wu:block suggestions for stuck spawns', () => {
      const stuckSpawns = [
        {
          spawn: createSpawn('spawn-1', 'pending'),
          ageMinutes: 45,
          lastCheckpoint: null,
        },
      ];

      const suggestions = generateSuggestions(stuckSpawns, []);

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].command).toContain('wu:block');
      expect(suggestions[0].command).toContain('WU-1001'); // targetWuId
      expect(suggestions[0].reason).toContain('45 minutes');
    });

    it('generates lane:unlock suggestions for zombie locks', () => {
      const zombieLocks = [
        {
          wuId: 'WU-1001',
          lane: TEST_LANE,
          pid: 12345,
          timestamp: new Date().toISOString(),
        },
      ];

      const suggestions = generateSuggestions([], zombieLocks);

      expect(suggestions.length).toBe(1);
      expect(suggestions[0].command).toContain('lane:unlock');
      expect(suggestions[0].command).toContain(TEST_LANE);
      expect(suggestions[0].reason).toContain('12345');
    });

    it('returns empty array when no issues', () => {
      const suggestions = generateSuggestions([], []);

      expect(suggestions).toEqual([]);
    });
  });

  describe('formatMonitorOutput', () => {
    it('includes spawn status summary section', () => {
      const result = {
        analysis: { pending: 2, completed: 3, timeout: 0, crashed: 1, total: 6 },
        stuckSpawns: [],
        zombieLocks: [],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Spawn Status Summary');
      expect(output).toContain('Pending:   2');
      expect(output).toContain('Completed: 3');
      expect(output).toContain('Crashed:   1');
      expect(output).toContain('Total:     6');
    });

    it('includes stuck spawns section when present', () => {
      const result = {
        analysis: { pending: 1, completed: 0, timeout: 0, crashed: 0, total: 1 },
        stuckSpawns: [
          {
            spawn: createSpawn('spawn-s1', 'pending'),
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

    it('includes zombie locks section when present', () => {
      const result = {
        analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
        stuckSpawns: [],
        zombieLocks: [
          {
            wuId: 'WU-1001',
            lane: TEST_LANE,
            pid: 99999,
            timestamp: new Date().toISOString(),
          },
        ],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Zombie Locks');
      expect(output).toContain(TEST_LANE);
      expect(output).toContain('99999');
    });

    it('includes suggestions section when present', () => {
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

  describe('formatRecoveryResults', () => {
    it('shows no recovery message when empty', () => {
      const output = formatRecoveryResults([]);

      expect(output).toContain('No recovery actions');
    });

    it('formats recovery results with counts', () => {
      const results = [
        {
          spawnId: 'spawn-1',
          targetWuId: 'WU-1001',
          action: 'released_zombie',
          recovered: true,
          reason: 'Zombie lock detected',
        },
        {
          spawnId: 'spawn-2',
          targetWuId: 'WU-1002',
          action: 'escalated_stuck',
          recovered: false,
          reason: 'No checkpoint in last hour',
        },
      ];

      const output = formatRecoveryResults(results);

      expect(output).toContain('Recovery Results');
      expect(output).toContain('WU-1001');
      expect(output).toContain('WU-1002');
      expect(output).toContain('Recovered: 1');
      expect(output).toContain('Escalated: 1');
    });
  });

  describe('LOG_PREFIX constant', () => {
    it('exports log prefix for consistent logging', () => {
      expect(LOG_PREFIX).toBe('[spawn-monitor]');
    });
  });

  describe('checkZombieLocks (WU-1421)', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('uses LUMENFLOW_PATHS.LOCKS_DIR not .beacon/locks', async () => {
      // Spy on fs.access to capture the path being checked
      const accessSpy = vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

      const baseDir = '/test/project';
      await checkZombieLocks({ baseDir });

      // Verify the path used is from LUMENFLOW_PATHS.LOCKS_DIR
      expect(accessSpy).toHaveBeenCalled();
      const calledPath = accessSpy.mock.calls[0][0] as string;

      // Should use .lumenflow/locks, NOT .beacon/locks
      expect(calledPath).toContain(LUMENFLOW_PATHS.LOCKS_DIR);
      expect(calledPath).not.toContain('.beacon');
      expect(calledPath).toBe(`${baseDir}/${LUMENFLOW_PATHS.LOCKS_DIR}`);
    });

    it('returns empty array when locks directory does not exist', async () => {
      vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

      const result = await checkZombieLocks({ baseDir: '/nonexistent' });

      expect(result).toEqual([]);
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
    completedAt: status === 'completed' ? new Date().toISOString() : null,
  };
}
