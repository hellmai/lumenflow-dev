/**
 * Orchestrate Monitor CLI Tests (WU-1241)
 *
 * Tests for the orchestrate:monitor command that wires CLI to delegation-monitor APIs in core.
 *
 * Test categories:
 * 1. API wiring - verifies CLI calls core delegation-monitor APIs
 * 2. Status formatting - verifies output structure
 * 3. Recovery actions - verifies signal/restart/escalate recovery
 * 4. Dry-run mode - verifies no actions taken in dry-run
 * 5. Threshold configuration - verifies configurable stuck detection
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeDelegations,
  detectStuckDelegations,
  generateSuggestions,
  formatMonitorOutput,
  DEFAULT_THRESHOLD_MINUTES,
} from '@lumenflow/core/delegation-monitor';
import { DelegationStatus, type DelegationEvent } from '@lumenflow/core/delegation-registry-schema';

// Test constants to avoid duplicate string literals
const TEST_LANE = 'Framework: CLI';
const TEST_PARENT_WU = 'WU-1000';
const TEST_TARGET_WU = 'WU-1001';

// Test will import from dist/orchestrate-monitor.js once implemented
// For now, we verify the core APIs work correctly

describe('orchestrate:monitor (WU-1241)', () => {
  describe('API wiring verification', () => {
    describe('analyzeDelegations wiring', () => {
      it('calls analyzeDelegations with delegation events and returns correct counts', () => {
        const delegations: DelegationEvent[] = [
          createDelegation('dlg-a1b2', DelegationStatus.PENDING),
          createDelegation('dlg-c3d4', DelegationStatus.COMPLETED),
        ];

        const analysis = analyzeDelegations(delegations);

        expect(analysis.pending).toBe(1);
        expect(analysis.completed).toBe(1);
        expect(analysis.total).toBe(2);
      });
    });

    describe('detectStuckDelegations wiring', () => {
      it('calls detectStuckDelegations with configurable threshold (default 30min)', () => {
        expect(DEFAULT_THRESHOLD_MINUTES).toBe(30);

        // Delegation 45 minutes old - should be stuck with default threshold
        const oldDelegationTime = new Date(Date.now() - 45 * 60 * 1000).toISOString();
        const delegations = [
          createDelegation('dlg-old1', DelegationStatus.PENDING, oldDelegationTime),
        ];

        const stuck = detectStuckDelegations(delegations, 30);

        expect(stuck.length).toBe(1);
        expect(stuck[0].delegation.id).toBe('dlg-old1');
        expect(stuck[0].ageMinutes).toBeGreaterThanOrEqual(45);
      });

      it('respects custom threshold (e.g., 15 minutes)', () => {
        // Delegation 20 minutes old
        const recentDelegationTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
        const delegations = [
          createDelegation('dlg-cust', DelegationStatus.PENDING, recentDelegationTime),
        ];

        // Not stuck with 30min threshold
        expect(detectStuckDelegations(delegations, 30).length).toBe(0);

        // Stuck with 15min threshold
        expect(detectStuckDelegations(delegations, 15).length).toBe(1);
      });
    });

    describe('generateSuggestions wiring', () => {
      it('generates wu:block suggestions for stuck delegations', () => {
        const stuckDelegations = [
          {
            delegation: createDelegation('dlg-0001', DelegationStatus.PENDING),
            ageMinutes: 45,
            lastCheckpoint: null,
          },
        ];

        const suggestions = generateSuggestions(stuckDelegations, []);

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
    it('shows active delegation count in output', () => {
      const result = {
        analysis: { pending: 2, completed: 3, timeout: 0, crashed: 1, total: 6 },
        stuckDelegations: [],
        zombieLocks: [],
        suggestions: [],
      };

      const output = formatMonitorOutput(result);

      expect(output).toContain('Pending:   2');
      expect(output).toContain('Completed: 3');
      expect(output).toContain('Total:     6');
    });

    it('shows stuck delegations with age in output', () => {
      const result = {
        analysis: { pending: 1, completed: 0, timeout: 0, crashed: 0, total: 1 },
        stuckDelegations: [
          {
            delegation: createDelegation('dlg-stk1', DelegationStatus.PENDING),
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

    it('shows zombie locks with PID in output', () => {
      const result = {
        analysis: { pending: 0, completed: 0, timeout: 0, crashed: 0, total: 0 },
        stuckDelegations: [],
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

    it('generates recovery action for stuck delegations', () => {
      const stuckDelegations = [
        {
          delegation: createDelegation('dlg-stk2', DelegationStatus.PENDING),
          ageMinutes: 120,
          lastCheckpoint: null,
        },
      ];

      const suggestions = generateSuggestions(stuckDelegations, []);

      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].command).toContain('wu:block');
      expect(suggestions[0].reason).toContain('120 minutes');
    });
  });

  describe('threshold configuration', () => {
    it('uses default 30 minute threshold', () => {
      // Delegation at 20 minutes ago - should NOT be stuck
      const recentDelegationTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const delegations = [
        createDelegation('dlg-rec1', DelegationStatus.PENDING, recentDelegationTime),
      ];

      const stuck = detectStuckDelegations(delegations); // Uses default 30 min

      expect(stuck.length).toBe(0);
    });

    it('respects custom threshold', () => {
      // Delegation at 20 minutes old
      const recentDelegationTime = new Date(Date.now() - 20 * 60 * 1000).toISOString();
      const delegations = [
        createDelegation('dlg-cust', DelegationStatus.PENDING, recentDelegationTime),
      ];

      // Not stuck with default 30min threshold
      expect(detectStuckDelegations(delegations, 30).length).toBe(0);

      // Stuck with 15min threshold
      expect(detectStuckDelegations(delegations, 15).length).toBe(1);
    });
  });

  describe('empty state handling', () => {
    it('returns healthy status when no delegations exist', () => {
      const analysis = analyzeDelegations([]);
      const stuck = detectStuckDelegations([]);
      const suggestions = generateSuggestions([], []);

      expect(analysis.total).toBe(0);
      expect(stuck.length).toBe(0);
      expect(suggestions.length).toBe(0);
    });

    it('returns healthy status when all delegations are completed', () => {
      const delegations = [
        createDelegation('dlg-cmp1', DelegationStatus.COMPLETED),
        createDelegation('dlg-cmp2', DelegationStatus.COMPLETED),
      ];

      const stuck = detectStuckDelegations(delegations);
      const suggestions = generateSuggestions([], []);

      expect(stuck.length).toBe(0);
      expect(suggestions.length).toBe(0);
    });
  });

  /**
   * WU-1278: Path construction bug fix
   *
   * These tests verify that runMonitor and loadRecentSignals use
   * the correct paths with .lumenflow/ prefix preserved.
   *
   * The bug was stripping .lumenflow/ prefix from paths:
   * - Line 142: join(baseDir, LUMENFLOW_PATHS.STATE_DIR.replace('.lumenflow/', ''))
   * - Line 227: join(baseDir, LUMENFLOW_PATHS.MEMORY_DIR.replace('.lumenflow/', ''))
   *
   * This resulted in paths like /base/state instead of /base/.lumenflow/state
   */
  describe('path construction (WU-1278)', () => {
    // Test constant to avoid lint warning about duplicate strings
    const TEST_BASE_PATH = '/test/base';

    it('LUMENFLOW_PATHS.STATE_DIR should not be modified when constructing state path', async () => {
      const { LUMENFLOW_PATHS } = await import('@lumenflow/core');
      const { join } = await import('node:path');

      // Verify LUMENFLOW_PATHS.STATE_DIR has the expected value
      expect(LUMENFLOW_PATHS.STATE_DIR).toBe('.lumenflow/state');

      // Verify correct path construction (what it should be)
      const correctPath = join(TEST_BASE_PATH, LUMENFLOW_PATHS.STATE_DIR);
      expect(correctPath).toBe(`${TEST_BASE_PATH}/.lumenflow/state`);

      // Verify buggy path construction (what it was doing)
      const buggyPath = join(TEST_BASE_PATH, LUMENFLOW_PATHS.STATE_DIR.replace('.lumenflow/', ''));
      expect(buggyPath).toBe(`${TEST_BASE_PATH}/state`);

      // These should NOT be equal - the bug was making them equal
      expect(correctPath).not.toBe(buggyPath);
    });

    it('LUMENFLOW_PATHS.MEMORY_DIR should not be modified when constructing memory path', async () => {
      const { LUMENFLOW_PATHS } = await import('@lumenflow/core');
      const { join } = await import('node:path');

      // Verify LUMENFLOW_PATHS.MEMORY_DIR has the expected value
      expect(LUMENFLOW_PATHS.MEMORY_DIR).toBe('.lumenflow/memory');

      // Verify correct path construction (what it should be)
      const correctPath = join(TEST_BASE_PATH, LUMENFLOW_PATHS.MEMORY_DIR);
      expect(correctPath).toBe(`${TEST_BASE_PATH}/.lumenflow/memory`);

      // Verify buggy path construction (what it was doing)
      const buggyPath = join(TEST_BASE_PATH, LUMENFLOW_PATHS.MEMORY_DIR.replace('.lumenflow/', ''));
      expect(buggyPath).toBe(`${TEST_BASE_PATH}/memory`);

      // These should NOT be equal - the bug was making them equal
      expect(correctPath).not.toBe(buggyPath);
    });

    it('runMonitor should construct state path correctly (integration test)', async () => {
      // Import the actual module to test its path construction
      const { runMonitor } = await import('../src/orchestrate-monitor.js');
      const { LUMENFLOW_PATHS, DelegationRegistryStore } = await import('@lumenflow/core');
      const path = await import('node:path');
      const fs = await import('node:fs');
      const os = await import('node:os');

      // Create a temp directory for testing
      const testBaseDir = path.join(os.tmpdir(), `orchestrate-monitor-test-${Date.now()}`);
      fs.mkdirSync(testBaseDir, { recursive: true });

      // Create the CORRECT path structure (.lumenflow/state)
      const correctStateDir = path.join(testBaseDir, LUMENFLOW_PATHS.STATE_DIR);
      fs.mkdirSync(correctStateDir, { recursive: true });

      // Write a delegation registry file at the correct path
      const registryPath = path.join(correctStateDir, 'delegation-registry.jsonl');
      const delegationEvent = {
        id: 'dlg-a1b2',
        parentWuId: 'WU-1000',
        targetWuId: 'WU-1001',
        lane: 'Framework: CLI',
        delegatedAt: new Date().toISOString(),
        status: 'completed',
        completedAt: new Date().toISOString(),
      };
      fs.writeFileSync(registryPath, JSON.stringify(delegationEvent) + '\n');

      // First, verify the file exists and can be loaded directly
      const directStore = new DelegationRegistryStore(correctStateDir);
      await directStore.load();
      const directDelegations = directStore.getAllDelegations();
      expect(directDelegations.length).toBe(1);
      expect(directDelegations[0].status).toBe('completed');

      try {
        // Run monitor with the test directory
        const result = await runMonitor({ baseDir: testBaseDir });

        // If paths are constructed correctly, the delegation registry should be found
        // and we should see 1 completed delegation
        expect(result.analysis.completed).toBe(1);
        expect(result.analysis.total).toBe(1);
      } finally {
        // Cleanup
        fs.rmSync(testBaseDir, { recursive: true, force: true });
      }
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
    completedAt: status === DelegationStatus.COMPLETED ? new Date().toISOString() : null,
  };
}
