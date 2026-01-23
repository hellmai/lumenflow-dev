/**
 * Initiative Orchestrator Tests (WU-2040)
 *
 * Tests for WU-2040 bug fixes:
 * - filterByDependencyStamps() only includes WUs whose ALL dependencies have stamps
 * - formatCheckpointOutput() outputs full Task invocation blocks with embedded prompts
 * - When no WUs can spawn due to missing stamps, output explains which WU is blocking
 * - Unit tests cover dependency stamp checking and same-lane linear chain
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Test constants
const STAMPS_DIR = '.lumenflow/stamps';

// Helper functions
function createDir(dir: string) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createStamp(wuId: string) {
  createDir(STAMPS_DIR);
  writeFileSync(
    join(STAMPS_DIR, `${wuId}.done`),
    JSON.stringify({ wuId, completedAt: new Date().toISOString() }),
  );
}

function removeStamp(wuId: string) {
  const path = join(STAMPS_DIR, `${wuId}.done`);
  if (existsSync(path)) {
    rmSync(path);
  }
}

function cleanupTestStamps() {
  if (existsSync(STAMPS_DIR)) {
    const files = readdirSync(STAMPS_DIR);
    for (const file of files) {
      if (file.startsWith('WU-TEST-')) {
        rmSync(join(STAMPS_DIR, file));
      }
    }
  }
}

describe('WU-2040: Dependency stamp checking logic', () => {
  beforeEach(() => {
    cleanupTestStamps();
  });

  afterEach(() => {
    cleanupTestStamps();
  });

  describe('AC1: filterByDependencyStamps() - WUs only included when ALL dependencies have stamps', () => {
    /**
     * Test the core filtering logic that should be in buildCheckpointWave.
     *
     * This tests the expected behavior: a WU should only be spawnable if ALL its
     * blocked_by dependencies have stamps.
     */
    it('should filter out WUs with unstamped dependencies (linear chain)', async () => {
      // Import the function that does dependency filtering
      const { filterByDependencyStamps } = await import('../src/initiative-orchestrator.js');

      // Mock WUs: A -> B -> C (B depends on A, C depends on B)
      const candidates = [
        { id: 'WU-TEST-A', doc: { lane: 'Test Lane', status: 'ready', blocked_by: [] } },
        { id: 'WU-TEST-B', doc: { lane: 'Test Lane', status: 'ready', blocked_by: ['WU-TEST-A'] } },
        { id: 'WU-TEST-C', doc: { lane: 'Test Lane', status: 'ready', blocked_by: ['WU-TEST-B'] } },
      ];

      // No stamps exist
      const result = filterByDependencyStamps(candidates);

      // Only WU-TEST-A should pass (no dependencies)
      expect(result.spawnable.map((w) => w.id)).toEqual(['WU-TEST-A']);

      // WU-TEST-B and WU-TEST-C should be blocked
      expect(result.blocked.map((w) => w.id)).toContain('WU-TEST-B');
      expect(result.blocked.map((w) => w.id)).toContain('WU-TEST-C');
    });

    it('should include WU-B after WU-A gets a stamp', async () => {
      const { filterByDependencyStamps } = await import('../src/initiative-orchestrator.js');

      const candidates = [
        { id: 'WU-TEST-A', doc: { lane: 'Test Lane', status: 'ready', blocked_by: [] } },
        { id: 'WU-TEST-B', doc: { lane: 'Test Lane', status: 'ready', blocked_by: ['WU-TEST-A'] } },
      ];

      // Create stamp for WU-TEST-A
      createStamp('WU-TEST-A');

      const result = filterByDependencyStamps(candidates);

      // Both should be spawnable now (A has no deps, B's dep is stamped)
      expect(result.spawnable.map((w) => w.id)).toContain('WU-TEST-A');
      expect(result.spawnable.map((w) => w.id)).toContain('WU-TEST-B');
    });

    it('should require ALL dependencies to have stamps, not just some', async () => {
      const { filterByDependencyStamps } = await import('../src/initiative-orchestrator.js');

      // WU-TEST-D depends on both WU-TEST-X and WU-TEST-Y
      const candidates = [
        { id: 'WU-TEST-X', doc: { lane: 'Lane X', status: 'ready', blocked_by: [] } },
        { id: 'WU-TEST-Y', doc: { lane: 'Lane Y', status: 'ready', blocked_by: [] } },
        {
          id: 'WU-TEST-D',
          doc: { lane: 'Lane D', status: 'ready', blocked_by: ['WU-TEST-X', 'WU-TEST-Y'] },
        },
      ];

      // Create stamp for only WU-TEST-X (not Y)
      createStamp('WU-TEST-X');

      const result = filterByDependencyStamps(candidates);

      // WU-TEST-D should NOT be spawnable (WU-TEST-Y has no stamp)
      expect(result.spawnable.map((w) => w.id)).not.toContain('WU-TEST-D');
      expect(result.spawnable.map((w) => w.id)).toContain('WU-TEST-X');
      expect(result.spawnable.map((w) => w.id)).toContain('WU-TEST-Y');
    });

    it('should handle 7-WU sequential chain (INIT-032 scenario)', async () => {
      const { filterByDependencyStamps } = await import('../src/initiative-orchestrator.js');

      // 7 sequential WUs all in the same lane (like INIT-032)
      const candidates = [];
      for (let i = 1; i <= 7; i++) {
        const blockedBy = i === 1 ? [] : [`WU-TEST-SEQ${i - 1}`];
        candidates.push({
          id: `WU-TEST-SEQ${i}`,
          doc: { lane: 'Same Lane', status: 'ready', blocked_by: blockedBy },
        });
      }

      const result = filterByDependencyStamps(candidates);

      // Only WU-TEST-SEQ1 should be spawnable (first in chain, no deps)
      expect(result.spawnable.length).toBe(1);
      expect(result.spawnable[0].id).toBe('WU-TEST-SEQ1');

      // The remaining 6 should be blocked
      expect(result.blocked.length).toBe(6);
    });
  });

  describe('AC3: When no WUs can spawn, return blocking info', () => {
    it('should identify blocking dependencies when all candidates are blocked', async () => {
      const { filterByDependencyStamps } = await import('../src/initiative-orchestrator.js');

      // All WUs have unmet dependencies
      const candidates = [
        { id: 'WU-TEST-B', doc: { lane: 'Test Lane', status: 'ready', blocked_by: ['WU-TEST-A'] } },
        { id: 'WU-TEST-C', doc: { lane: 'Test Lane', status: 'ready', blocked_by: ['WU-TEST-B'] } },
      ];

      const result = filterByDependencyStamps(candidates);

      // No WUs should be spawnable
      expect(result.spawnable).toEqual([]);

      // Should report blocking dependencies
      expect(result.blockingDeps).toBeDefined();
      expect(result.blockingDeps).toContain('WU-TEST-A');
    });

    it('should provide actionable waiting message', async () => {
      const { filterByDependencyStamps } = await import('../src/initiative-orchestrator.js');

      const candidates = [
        {
          id: 'WU-TEST-ORPHAN',
          doc: { lane: 'Test Lane', status: 'ready', blocked_by: ['WU-MISSING'] },
        },
      ];

      const result = filterByDependencyStamps(candidates);

      // Should have a waiting message explaining the blocker
      expect(result.waitingMessage).toBeDefined();
      expect(result.waitingMessage).toContain('WU-MISSING');
    });
  });
});

describe('WU-2280: Prevent false wave spawned confusion', () => {
  const TEST_WU_DIR = 'docs/04-operations/tasks/wu';

  function createDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  function createTestWUFile(
    wuId: string,
    options: { lane?: string; status?: string; blockedBy?: string[] } = {},
  ) {
    const { lane = 'Test Lane', status = 'ready', blockedBy = [] } = options;
    createDir(TEST_WU_DIR);

    const blockedByYaml =
      blockedBy.length > 0 ? '\n' + blockedBy.map((id) => `  - ${id}`).join('\n') : ' []';

    const yaml = `id: ${wuId}
title: Test WU ${wuId}
lane: '${lane}'
type: task
status: ${status}
priority: P2
created: 2025-01-01
code_paths: []
tests:
  manual: []
  unit: []
  e2e: []
artifacts: []
dependencies: []
blocked_by:${blockedByYaml}
risks: []
notes: ''
requires_review: false
description: Test WU for WU-2280 tests
acceptance:
  - Test passes
`;

    writeFileSync(join(TEST_WU_DIR, `${wuId}.yaml`), yaml);
  }

  function cleanupTestWUs() {
    if (existsSync(TEST_WU_DIR)) {
      const files = readdirSync(TEST_WU_DIR);
      for (const file of files) {
        if (file.startsWith('WU-TEST-2280')) {
          rmSync(join(TEST_WU_DIR, file));
        }
      }
    }
  }

  beforeEach(() => {
    cleanupTestWUs();
  });

  afterEach(() => {
    cleanupTestWUs();
  });

  describe('AC1: Output format unambiguously NOT a tool call', () => {
    it('should NOT output raw antml XML tags that could be interpreted as tool calls', async () => {
      createTestWUFile('WU-TEST-2280A', { lane: 'Test Lane A', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST',
        wave: 0,
        wus: [{ id: 'WU-TEST-2280A', lane: 'Test Lane A' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-wave-0.json',
      };

      const output = formatCheckpointOutput(waveData);

      // Output should NOT contain raw XML tool invocation syntax
      // Raw tags like <function_calls> could be mistaken for actual tool calls
      // Instead, output should use escaped/quoted format or markdown code blocks
      const hasRawFunctionCalls = output.includes('<function_calls>');
      const hasRawInvoke = output.includes('<invoke');

      // These should NOT be raw - should be in a code block or escaped
      expect(hasRawFunctionCalls).toBe(false);
      expect(hasRawInvoke).toBe(false);
    });

    it('should wrap XML content in markdown code blocks', async () => {
      createTestWUFile('WU-TEST-2280B', { lane: 'Test Lane B', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST',
        wave: 0,
        wus: [{ id: 'WU-TEST-2280B', lane: 'Test Lane B' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-wave-0.json',
      };

      const output = formatCheckpointOutput(waveData);

      // XML content should be in a code block (triple backticks)
      expect(output).toContain('```xml');
      expect(output).toContain('```');
    });
  });

  describe('AC2: Clear ACTION REQUIRED banner', () => {
    it('should include ACTION REQUIRED banner at the top of spawn output', async () => {
      createTestWUFile('WU-TEST-2280C', { lane: 'Test Lane C', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST',
        wave: 0,
        wus: [{ id: 'WU-TEST-2280C', lane: 'Test Lane C' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-wave-0.json',
      };

      const output = formatCheckpointOutput(waveData);

      // Should have ACTION REQUIRED banner
      expect(output).toContain('ACTION REQUIRED');
    });

    it('should instruct agent to copy and invoke Task tool', async () => {
      createTestWUFile('WU-TEST-2280D', { lane: 'Test Lane D', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST',
        wave: 0,
        wus: [{ id: 'WU-TEST-2280D', lane: 'Test Lane D' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-wave-0.json',
      };

      const output = formatCheckpointOutput(waveData);

      // Should have clear instruction about what the agent needs to do
      expect(output).toContain('copy');
      expect(output).toContain('Task');
    });

    it('should clarify that nothing was spawned yet', async () => {
      createTestWUFile('WU-TEST-2280E', { lane: 'Test Lane E', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST',
        wave: 0,
        wus: [{ id: 'WU-TEST-2280E', lane: 'Test Lane E' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-wave-0.json',
      };

      const output = formatCheckpointOutput(waveData);

      // Should make clear that waves have NOT been spawned
      const lowerOutput = output.toLowerCase();
      expect(lowerOutput).toContain('not');
      expect(lowerOutput).toMatch(/spawned|executed|invoked/);
    });
  });
});

/**
 * WU-2430: BUG: orchestrate:initiative dry-run and planning mismatch
 *
 * Tests for:
 * - AC1: --dry-run never writes wave manifests or prints wave spawned messaging
 * - AC2: --dry-run output clearly reflects the effective execution mode
 * - AC3: Execution plans only schedule status: ready WUs and surface blocked/in_progress as skipped
 * - AC4: Polling-mode planning defers WUs with unstamped blocked_by dependencies
 * - AC5: Unit tests cover dry-run suppression and ready-only filtering
 */
describe('WU-2430: dry-run suppression and ready-only filtering', () => {
  const TEST_WU_DIR = 'docs/04-operations/tasks/wu';
  const WAVE_MANIFEST_DIR = '.lumenflow/artifacts/waves';

  function createDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  function createTestWUFile(
    wuId: string,
    options: { lane?: string; status?: string; blockedBy?: string[] } = {},
  ) {
    const { lane = 'Test Lane', status = 'ready', blockedBy = [] } = options;
    createDir(TEST_WU_DIR);

    const blockedByYaml =
      blockedBy.length > 0 ? '\n' + blockedBy.map((id) => `  - ${id}`).join('\n') : ' []';

    const yaml = `id: ${wuId}
title: Test WU ${wuId}
lane: '${lane}'
type: task
status: ${status}
priority: P2
created: 2025-01-01
code_paths: []
tests:
  manual: []
  unit: []
  e2e: []
artifacts: []
dependencies: []
blocked_by:${blockedByYaml}
risks: []
notes: ''
requires_review: false
description: Test WU for WU-2430 tests
acceptance:
  - Test passes
`;

    writeFileSync(join(TEST_WU_DIR, `${wuId}.yaml`), yaml);
  }

  function cleanupTestWUs() {
    if (existsSync(TEST_WU_DIR)) {
      const files = readdirSync(TEST_WU_DIR);
      for (const file of files) {
        if (file.startsWith('WU-TEST-2430')) {
          rmSync(join(TEST_WU_DIR, file));
        }
      }
    }
  }

  function cleanupWaveManifests() {
    if (existsSync(WAVE_MANIFEST_DIR)) {
      const files = readdirSync(WAVE_MANIFEST_DIR);
      for (const file of files) {
        if (file.startsWith('INIT-TEST-2430')) {
          rmSync(join(WAVE_MANIFEST_DIR, file));
        }
      }
    }
  }

  beforeEach(() => {
    cleanupTestWUs();
    cleanupWaveManifests();
  });

  afterEach(() => {
    cleanupTestWUs();
    cleanupWaveManifests();
  });

  describe('AC1: --dry-run never writes wave manifests or prints wave spawned messaging', () => {
    // Note: buildCheckpointWave requires a real initiative. These tests verify
    // the formatCheckpointOutput and buildExecutionPlan behavior for dry-run.
    it('should indicate dry-run status via formatCheckpointOutput when dryRun flag is set', async () => {
      createTestWUFile('WU-TEST-2430A', { lane: 'Test Lane A', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      // Simulate wave data with dryRun flag
      const waveData = {
        initiative: 'INIT-TEST-2430',
        wave: 0,
        wus: [{ id: 'WU-TEST-2430A', lane: 'Test Lane A' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-2430-wave-0.json',
        dryRun: true,
      };

      const output = formatCheckpointOutput(waveData);

      // Should indicate dry-run mode
      const lowerOutput = output.toLowerCase();
      expect(lowerOutput).toMatch(/dry[- ]?run/);
    });

    it('should not include "wave spawned" messaging in dry-run output', async () => {
      createTestWUFile('WU-TEST-2430B', { lane: 'Test Lane B', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST-2430',
        wave: 0,
        wus: [{ id: 'WU-TEST-2430B', lane: 'Test Lane B' }],
        manifestPath: null, // dry-run: no manifest written
        dryRun: true,
      };

      const output = formatCheckpointOutput(waveData);

      // Should NOT contain misleading "spawned" messaging
      const lowerOutput = output.toLowerCase();
      expect(lowerOutput).not.toMatch(/wave \d+ spawned/i);
    });
  });

  describe('AC2: --dry-run output clearly reflects the effective execution mode', () => {
    it('should indicate dry-run mode in checkpoint output when dryRun is true', async () => {
      createTestWUFile('WU-TEST-2430C', { lane: 'Test Lane C', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST-2430',
        wave: 0,
        wus: [{ id: 'WU-TEST-2430C', lane: 'Test Lane C' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-2430-wave-0.json',
        dryRun: true,
      };

      const output = formatCheckpointOutput(waveData);

      // Should clearly indicate dry-run / preview mode
      const lowerOutput = output.toLowerCase();
      expect(lowerOutput).toMatch(/dry[- ]?run|preview/);
    });

    it('should indicate checkpoint mode is suppressed in dry-run preview', async () => {
      // When auto-checkpoint mode would have been enabled but we're in dry-run,
      // output should indicate checkpoint mode is suppressed
      const { resolveCheckpointMode } = await import('../src/initiative-orchestrator.js');

      // Simulate WUs that would trigger auto-checkpoint (>3 pending)
      const wus = [
        { id: 'WU-1', doc: { status: 'ready' } },
        { id: 'WU-2', doc: { status: 'ready' } },
        { id: 'WU-3', doc: { status: 'ready' } },
        { id: 'WU-4', doc: { status: 'ready' } },
      ];

      // WU-2430: dryRun flag should suppress auto-detection
      const decision = resolveCheckpointMode({ dryRun: true }, wus);

      expect(decision.enabled).toBe(false);
      expect(decision.source).toBe('dryrun');
    });
  });

  describe('AC3: Execution plans only schedule status: ready WUs', () => {
    it('should only include ready WUs in execution plan', async () => {
      const { buildExecutionPlan } = await import('../src/initiative-orchestrator.js');

      const wus = [
        { id: 'WU-TEST-READY', doc: { status: 'ready', lane: 'Lane A', blocked_by: [] } },
        { id: 'WU-TEST-BLOCKED', doc: { status: 'blocked', lane: 'Lane B', blocked_by: [] } },
        {
          id: 'WU-TEST-INPROGRESS',
          doc: { status: 'in_progress', lane: 'Lane C', blocked_by: [] },
        },
        { id: 'WU-TEST-DONE', doc: { status: 'done', lane: 'Lane D', blocked_by: [] } },
      ];

      const plan = buildExecutionPlan(wus);

      // Get all WU IDs in waves
      const wuIdsInWaves = plan.waves.flat().map((wu) => wu.id);

      // Only ready WUs should be in waves
      expect(wuIdsInWaves).toContain('WU-TEST-READY');
      expect(wuIdsInWaves).not.toContain('WU-TEST-BLOCKED');
      expect(wuIdsInWaves).not.toContain('WU-TEST-INPROGRESS');
      expect(wuIdsInWaves).not.toContain('WU-TEST-DONE');
    });

    it('should report skipped WUs with reasons in plan', async () => {
      const { buildExecutionPlan } = await import('../src/initiative-orchestrator.js');

      const wus = [
        { id: 'WU-TEST-READY', doc: { status: 'ready', lane: 'Lane A', blocked_by: [] } },
        { id: 'WU-TEST-BLOCKED', doc: { status: 'blocked', lane: 'Lane B', blocked_by: [] } },
        {
          id: 'WU-TEST-INPROGRESS',
          doc: { status: 'in_progress', lane: 'Lane C', blocked_by: [] },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Plan should have skipped info
      expect(plan.skipped).toBeDefined();
      expect(Array.isArray(plan.skipped)).toBe(true);
    });

    it('should include status reason in skipped array for non-ready WUs', async () => {
      const { buildExecutionPlan } = await import('../src/initiative-orchestrator.js');

      const wus = [
        { id: 'WU-TEST-BLOCKED', doc: { status: 'blocked', lane: 'Lane B', blocked_by: [] } },
        {
          id: 'WU-TEST-INPROGRESS',
          doc: { status: 'in_progress', lane: 'Lane C', blocked_by: [] },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Should have skipped entries with reasons
      expect(plan.skippedWithReasons).toBeDefined();
      const blockedEntry = plan.skippedWithReasons.find((s) => s.id === 'WU-TEST-BLOCKED');
      const inProgressEntry = plan.skippedWithReasons.find((s) => s.id === 'WU-TEST-INPROGRESS');

      expect(blockedEntry).toBeDefined();
      expect(blockedEntry.reason).toMatch(/blocked/i);
      expect(inProgressEntry).toBeDefined();
      expect(inProgressEntry.reason).toMatch(/in.?progress/i);
    });
  });

  describe('AC4: Polling-mode planning defers WUs with unstamped blocked_by dependencies', () => {
    it('should defer WUs whose blocked_by dependencies lack stamps (external blockers)', async () => {
      const { buildExecutionPlan } = await import('../src/initiative-orchestrator.js');

      // WU-EXT-BLOCKER is not in the initiative but is a blocked_by dependency
      const wus = [
        {
          id: 'WU-TEST-NEEDS-EXT',
          doc: { status: 'ready', lane: 'Lane A', blocked_by: ['WU-EXT-BLOCKER'] },
        },
      ];

      // No stamp exists for WU-EXT-BLOCKER
      const plan = buildExecutionPlan(wus);

      // The WU should be deferred, not in wave 0
      const wuIdsInWaves = plan.waves.flat().map((wu) => wu.id);
      expect(wuIdsInWaves).not.toContain('WU-TEST-NEEDS-EXT');

      // Should be in deferred list
      expect(plan.deferred).toBeDefined();
      const deferredIds = plan.deferred.map((d) => d.id);
      expect(deferredIds).toContain('WU-TEST-NEEDS-EXT');
    });

    it('should include external blockers without stamps in deferred reasons', async () => {
      const { buildExecutionPlan } = await import('../src/initiative-orchestrator.js');

      const wus = [
        {
          id: 'WU-TEST-EXTERNAL-DEP',
          doc: { status: 'ready', lane: 'Lane A', blocked_by: ['WU-EXT-123', 'WU-EXT-456'] },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Deferred entry should explain which dependencies are blocking
      const deferred = plan.deferred?.find((d) => d.id === 'WU-TEST-EXTERNAL-DEP');
      expect(deferred).toBeDefined();
      expect(deferred.blockedBy).toBeDefined();
      expect(deferred.blockedBy).toContain('WU-EXT-123');
      expect(deferred.blockedBy).toContain('WU-EXT-456');
    });
  });

  describe('AC5: formatExecutionPlan shows skipped and deferred WUs with reasons', () => {
    it('should include skipped WUs in formatted output', async () => {
      const { formatExecutionPlan } = await import('../src/initiative-orchestrator.js');

      const initiative = { id: 'INIT-TEST', title: 'Test Initiative' };
      const plan = {
        waves: [[{ id: 'WU-1', doc: { title: 'Ready WU', blocked_by: [] } }]],
        skipped: ['WU-DONE'],
        skippedWithReasons: [
          { id: 'WU-BLOCKED', reason: 'status: blocked' },
          { id: 'WU-IP', reason: 'status: in_progress' },
        ],
        deferred: [],
      };

      const output = formatExecutionPlan(initiative, plan);

      // Should mention skipped WUs
      expect(output).toMatch(/skip/i);
      expect(output).toContain('WU-BLOCKED');
      expect(output).toContain('WU-IP');
    });

    it('should include deferred WUs with blocking reasons in formatted output', async () => {
      const { formatExecutionPlan } = await import('../src/initiative-orchestrator.js');

      const initiative = { id: 'INIT-TEST', title: 'Test Initiative' };
      const plan = {
        waves: [],
        skipped: [],
        skippedWithReasons: [],
        deferred: [{ id: 'WU-DEFERRED', blockedBy: ['WU-EXT-1'], reason: 'waiting for WU-EXT-1' }],
      };

      const output = formatExecutionPlan(initiative, plan);

      // Should mention deferred/waiting WUs
      expect(output).toMatch(/defer|wait/i);
      expect(output).toContain('WU-DEFERRED');
      expect(output).toContain('WU-EXT-1');
    });
  });
});

/**
 * WU-2432: BUG: internal blocker deferral + dry-run output alignment
 *
 * Tests for:
 * - Ready WUs blocked by internal non-ready WUs are deferred
 * - Deferral cascades when internal blockers are deferred
 * - Non-ready statuses (including waiting) are reported in skippedWithReasons
 * - Dry-run preview output uses Task XML, not pnpm wu:spawn commands
 */
describe('WU-2432: internal blockers and dry-run output alignment', () => {
  it('should defer ready WUs blocked by internal non-ready WUs', async () => {
    const { buildExecutionPlan } = await import('../src/initiative-orchestrator.js');

    const wus = [
      { id: 'WU-TEST-INT-BLOCKER', doc: { status: 'blocked', lane: 'Lane A', blocked_by: [] } },
      {
        id: 'WU-TEST-INT-DEP',
        doc: { status: 'ready', lane: 'Lane B', blocked_by: ['WU-TEST-INT-BLOCKER'] },
      },
    ];

    const plan = buildExecutionPlan(wus);
    const wuIdsInWaves = plan.waves.flat().map((wu) => wu.id);

    expect(wuIdsInWaves).not.toContain('WU-TEST-INT-DEP');
    expect(plan.deferred?.some((entry) => entry.id === 'WU-TEST-INT-DEP')).toBe(true);
  });

  it('should cascade deferral when internal blockers are deferred', async () => {
    const { buildExecutionPlan } = await import('../src/initiative-orchestrator.js');

    const wus = [
      {
        id: 'WU-TEST-EXT-BLOCKER',
        doc: { status: 'ready', lane: 'Lane A', blocked_by: ['WU-EXT-NO-STAMP'] },
      },
      {
        id: 'WU-TEST-EXT-DEP',
        doc: { status: 'ready', lane: 'Lane B', blocked_by: ['WU-TEST-EXT-BLOCKER'] },
      },
    ];

    const plan = buildExecutionPlan(wus);

    expect(plan.deferred?.some((entry) => entry.id === 'WU-TEST-EXT-BLOCKER')).toBe(true);
    expect(plan.deferred?.some((entry) => entry.id === 'WU-TEST-EXT-DEP')).toBe(true);
  });

  it('should report waiting status as skippedWithReasons', async () => {
    const { buildExecutionPlan } = await import('../src/initiative-orchestrator.js');

    const wus = [
      { id: 'WU-TEST-WAITING', doc: { status: 'waiting', lane: 'Lane A', blocked_by: [] } },
    ];

    const plan = buildExecutionPlan(wus);
    const waitingEntry = plan.skippedWithReasons?.find((entry) => entry.id === 'WU-TEST-WAITING');

    expect(waitingEntry).toBeDefined();
    expect(waitingEntry.reason).toMatch(/waiting/i);
  });

  it('should output Task XML blocks for execution plan previews', async () => {
    const { formatExecutionPlanWithEmbeddedSpawns } =
      await import('../src/initiative-orchestrator.js');

    const plan = {
      waves: [
        [
          {
            id: 'WU-TEST-XML',
            doc: { title: 'Test WU', lane: 'Lane A', status: 'ready', type: 'task' },
          },
        ],
      ],
      skipped: [],
    };

    const output = formatExecutionPlanWithEmbeddedSpawns(plan);

    expect(output).toContain('antml:invoke name="Task"');
    expect(output).not.toContain('pnpm wu:spawn');
  });
});

describe('WU-2040: Checkpoint mode Task invocation output', () => {
  const TEST_WU_DIR = 'docs/04-operations/tasks/wu';

  function createDir(dir: string) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  function createTestWUFile(
    wuId: string,
    options: { lane?: string; status?: string; blockedBy?: string[] } = {},
  ) {
    const { lane = 'Test Lane', status = 'ready', blockedBy = [] } = options;
    createDir(TEST_WU_DIR);

    const blockedByYaml =
      blockedBy.length > 0 ? '\n' + blockedBy.map((id) => `  - ${id}`).join('\n') : ' []';

    const yaml = `id: ${wuId}
title: Test WU ${wuId}
lane: '${lane}'
type: task
status: ${status}
priority: P2
created: 2025-01-01
code_paths: []
tests:
  manual: []
  unit: []
  e2e: []
artifacts: []
dependencies: []
blocked_by:${blockedByYaml}
risks: []
notes: ''
requires_review: false
description: Test WU for WU-2040 tests
acceptance:
  - Test passes
`;

    writeFileSync(join(TEST_WU_DIR, `${wuId}.yaml`), yaml);
  }

  function cleanupTestWUs() {
    if (existsSync(TEST_WU_DIR)) {
      const files = readdirSync(TEST_WU_DIR);
      for (const file of files) {
        if (file.startsWith('WU-TEST-TASK')) {
          rmSync(join(TEST_WU_DIR, file));
        }
      }
    }
  }

  beforeEach(() => {
    cleanupTestWUs();
  });

  afterEach(() => {
    cleanupTestWUs();
  });

  describe('AC2: formatCheckpointOutput outputs full Task invocation blocks', () => {
    it('should NOT output pnpm wu:spawn meta-prompt commands', async () => {
      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      // Mock waveData as would be returned by buildCheckpointWave
      const waveData = {
        initiative: 'INIT-TEST',
        wave: 0,
        wus: [{ id: 'WU-TEST-1', lane: 'Test Lane' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-wave-0.json',
      };

      const output = formatCheckpointOutput(waveData);

      // The output should NOT contain meta-prompt spawn commands
      // After WU-2040 fix, should output full Task invocation with embedded prompt
      const hasMetaPrompt = output.includes('pnpm wu:spawn --id');
      expect(hasMetaPrompt).toBe(false);
    });

    it('should include Task invocation with embedded spawn prompt when WU file exists', async () => {
      // Create a real WU file for this test
      createTestWUFile('WU-TEST-TASK1', { lane: 'Task Test Lane', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST',
        wave: 0,
        wus: [{ id: 'WU-TEST-TASK1', lane: 'Task Test Lane' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-wave-0.json',
      };

      const output = formatCheckpointOutput(waveData);

      // After fix, output should include Task invocation XML blocks
      const hasTaskInvoke = output.includes('antml:invoke name="Task"');
      const hasPromptParam = output.includes('antml:parameter name="prompt"');

      expect(hasTaskInvoke).toBe(true);
      expect(hasPromptParam).toBe(true);
    });

    it('should output function_calls wrapper for Task invocations', async () => {
      createTestWUFile('WU-TEST-TASK2', { lane: 'Task Test Lane 2', status: 'ready' });

      const { formatCheckpointOutput } = await import('../src/initiative-orchestrator.js');

      const waveData = {
        initiative: 'INIT-TEST',
        wave: 0,
        wus: [{ id: 'WU-TEST-TASK2', lane: 'Task Test Lane 2' }],
        manifestPath: '.lumenflow/artifacts/waves/INIT-TEST-wave-0.json',
      };

      const output = formatCheckpointOutput(waveData);

      // Should have proper function_calls wrapper
      expect(output).toContain('antml:function_calls');
    });
  });
});
