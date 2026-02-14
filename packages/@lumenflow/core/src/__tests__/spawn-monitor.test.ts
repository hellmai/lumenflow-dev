/**
 * Delegation Monitor Core API Tests (WU-1241)
 *
 * Tests for the delegation-monitor library in @lumenflow/core.
 * These tests verify the core monitoring logic used by orchestrate:monitor CLI.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import {
  analyzeDelegations,
  detectStuckDelegations,
  generateSuggestions,
  formatMonitorOutput,
  formatRecoveryResults,
  checkZombieLocks,
  DEFAULT_THRESHOLD_MINUTES,
  LOG_PREFIX,
} from '../delegation-monitor.js';
import { LUMENFLOW_PATHS } from '../wu-constants.js';
import { type DelegationEvent } from '../delegation-registry-schema.js';

// Test constants to avoid duplicate string literals
const TEST_LANE = 'Framework: CLI';
const TEST_PARENT_WU = 'WU-1000';
const TEST_TARGET_WU = 'WU-1001';

describe('delegation-monitor core APIs (WU-1241)', () => {
  describe('analyzeDelegations', () => {
    it('counts delegations by status correctly', () => {
      const delegations: DelegationEvent[] = [
        createDelegation('dlg-a001', 'pending'),
        createDelegation('dlg-b002', 'pending'),
        createDelegation('dlg-c003', 'completed'),
        createDelegation('dlg-d004', 'timeout'),
        createDelegation('dlg-e005', 'crashed'),
      ];

      const analysis = analyzeDelegations(delegations);

      expect(analysis.pending).toBe(2);
      expect(analysis.completed).toBe(1);
      expect(analysis.timeout).toBe(1);
      expect(analysis.crashed).toBe(1);
      expect(analysis.total).toBe(5);
    });

    it('returns zero counts for empty array', () => {
      const analysis = analyzeDelegations([]);

      expect(analysis.pending).toBe(0);
      expect(analysis.completed).toBe(0);
      expect(analysis.timeout).toBe(0);
      expect(analysis.crashed).toBe(0);
      expect(analysis.total).toBe(0);
    });
  });

  describe('detectStuckDelegations', () => {
    it('uses default threshold of 30 minutes', () => {
      expect(DEFAULT_THRESHOLD_MINUTES).toBe(30);
    });

    it('detects pending delegations older than threshold', () => {
      const oldDelegationTime = new Date(Date.now() - 45 * 60 * 1000).toISOString();
      const delegations = [createDelegation('dlg-a111', 'pending', oldDelegationTime)];

      const stuck = detectStuckDelegations(delegations, 30);

      expect(stuck.length).toBe(1);
      expect(stuck[0].delegation.id).toBe('dlg-a111');
      expect(stuck[0].ageMinutes).toBeGreaterThanOrEqual(45);
    });

    it('ignores pending delegations within threshold', () => {
      const recentDelegationTime = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const delegations = [createDelegation('dlg-a112', 'pending', recentDelegationTime)];

      const stuck = detectStuckDelegations(delegations, 30);

      expect(stuck.length).toBe(0);
    });

    it('ignores completed delegations regardless of age', () => {
      const oldDelegationTime = new Date(Date.now() - 120 * 60 * 1000).toISOString();
      const delegations = [createDelegation('dlg-a113', 'completed', oldDelegationTime)];

      const stuck = detectStuckDelegations(delegations, 30);

      expect(stuck.length).toBe(0);
    });

    it('sorts stuck delegations by age descending (oldest first)', () => {
      const delegations = [
        createDelegation('dlg-a114', 'pending', new Date(Date.now() - 35 * 60 * 1000).toISOString()),
        createDelegation('dlg-a115', 'pending', new Date(Date.now() - 65 * 60 * 1000).toISOString()),
        createDelegation('dlg-a116', 'pending', new Date(Date.now() - 50 * 60 * 1000).toISOString()),
      ];

      const stuck = detectStuckDelegations(delegations, 30);

      expect(stuck.length).toBe(3);
      expect(stuck[0].delegation.id).toBe('dlg-a115'); // Oldest first
      expect(stuck[1].delegation.id).toBe('dlg-a116');
      expect(stuck[2].delegation.id).toBe('dlg-a114');
    });

    it('respects custom threshold', () => {
      const delegationTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const delegations = [createDelegation('dlg-a117', 'pending', delegationTime)];

      // With 30min threshold, not stuck
      expect(detectStuckDelegations(delegations, 30).length).toBe(0);

      // With 15min threshold, stuck
      expect(detectStuckDelegations(delegations, 15).length).toBe(1);
    });
  });

  describe('generateSuggestions', () => {
    it('generates wu:block suggestions for stuck delegations', () => {
      const stuckDelegations = [
        {
          delegation: createDelegation('dlg-a118', 'pending'),
          ageMinutes: 45,
          lastCheckpoint: null,
        },
      ];

      const suggestions = generateSuggestions(stuckDelegations, []);

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
    it('includes delegation status summary section', () => {
      const result = {
        analysis: { pending: 2, completed: 3, timeout: 0, crashed: 1, total: 6 },
        stuckDelegations: [],
        zombieLocks: [],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Delegation Status Summary');
      expect(output).toContain('Pending:   2');
      expect(output).toContain('Completed: 3');
      expect(output).toContain('Crashed:   1');
      expect(output).toContain('Total:     6');
    });

    it('includes stuck delegations section when present', () => {
      const result = {
        analysis: { pending: 1, completed: 0, timeout: 0, crashed: 0, total: 1 },
        stuckDelegations: [
          {
            delegation: createDelegation('dlg-a119', 'pending'),
            ageMinutes: 60,
            lastCheckpoint: null,
          },
        ],
        zombieLocks: [],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Stuck Delegations');
      expect(output).toContain('WU-1001');
      expect(output).toContain('60 minutes');
    });

    it('includes zombie locks section when present', () => {
      const result = {
        analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
        stuckDelegations: [],
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
        stuckDelegations: [],
        zombieLocks: [],
        suggestions: [
          {
            command: 'pnpm wu:block --id WU-1001',
            reason: 'Delegation stuck for 45 minutes',
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
        stuckDelegations: [],
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
          delegationId: 'dlg-a120',
          targetWuId: 'WU-1001',
          action: 'released_zombie',
          recovered: true,
          reason: 'Zombie lock detected',
        },
        {
          delegationId: 'dlg-a121',
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
      expect(LOG_PREFIX).toBe('[delegation-monitor]');
    });
  });

  describe('checkZombieLocks (WU-1421)', () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('uses LUMENFLOW_PATHS.LOCKS_DIR', async () => {
      // Spy on fs.access to capture the path being checked
      const accessSpy = vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

      const baseDir = '/test/project';
      await checkZombieLocks({ baseDir });

      // Verify the path used is from LUMENFLOW_PATHS.LOCKS_DIR
      expect(accessSpy).toHaveBeenCalled();
      const calledPath = accessSpy.mock.calls[0][0] as string;

      // Should use .lumenflow/locks
      expect(calledPath).toContain(LUMENFLOW_PATHS.LOCKS_DIR);
      expect(calledPath).toBe(`${baseDir}/${LUMENFLOW_PATHS.LOCKS_DIR}`);
    });

    it('returns empty array when locks directory does not exist', async () => {
      vi.spyOn(fs, 'access').mockRejectedValue(new Error('ENOENT'));

      const result = await checkZombieLocks({ baseDir: '/nonexistent' });

      expect(result).toEqual([]);
    });
  });
});

// Helper function to create mock delegation events
function createDelegation(id: string, status: string, delegatedAt?: string): DelegationEvent {
  return {
    id,
    parentWuId: TEST_PARENT_WU,
    targetWuId: TEST_TARGET_WU,
    lane: TEST_LANE,
    delegatedAt: delegatedAt || new Date().toISOString(),
    status: status as DelegationEvent['status'],
    completedAt: status === 'completed' ? new Date().toISOString() : null,
  };
}
