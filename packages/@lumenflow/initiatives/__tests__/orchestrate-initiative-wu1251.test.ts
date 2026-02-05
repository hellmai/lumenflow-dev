/**
 * WU-1251: orchestrate:initiative dependency resolution tests
 *
 * Bug: orchestrate:initiative --dry-run ignores WU dependencies array when building execution plan.
 * WU-1240 has dependencies: [WU-1234] but both are placed in Wave 0.
 * The wave calculation should respect the dependencies array and only place WUs in a wave
 * after all their dependencies are scheduled in earlier waves.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildExecutionPlan,
  buildExecutionPlanAsync,
  formatExecutionPlan,
} from '@lumenflow/initiatives';

const STAMPS_DIR = '.lumenflow/stamps';
const TEST_WU_DIR = 'docs/04-operations/tasks/wu';

// Lane constants to avoid duplicate string literals
const LANE_A = 'Lane A';
const LANE_B = 'Lane B';
const LANE_C = 'Lane C';
const LANE_MEMORY = 'Framework: Memory';
const LANE_CORE = 'Framework: Core';

// WU ID constants for test cases
const WU_TEST_A = 'WU-TEST-1251-A';
const WU_TEST_B = 'WU-TEST-1251-B';
const WU_TEST_1234 = 'WU-TEST-1251-1234';
const WU_TEST_1240 = 'WU-TEST-1251-1240';
const WU_TEST_CHAIN_A = 'WU-TEST-1251-CHAIN-A';
const WU_TEST_CHAIN_B = 'WU-TEST-1251-CHAIN-B';
const WU_TEST_CHAIN_C = 'WU-TEST-1251-CHAIN-C';
const WU_TEST_MIX_A = 'WU-TEST-1251-MIX-A';
const WU_TEST_MIX_B = 'WU-TEST-1251-MIX-B';
const WU_TEST_MIX_C = 'WU-TEST-1251-MIX-C';
const WU_TEST_FMT_A = 'WU-TEST-1251-FMT-A';
const WU_TEST_FMT_B = 'WU-TEST-1251-FMT-B';
const WU_TEST_DEP = 'WU-TEST-1251-DEP';
const WU_TEST_STAMPED = 'WU-TEST-1251-STAMPED';
const WU_TEST_READY_DEP = 'WU-TEST-1251-READY-DEP';
const WU_TEST_ASYNC_A = 'WU-TEST-1251-ASYNC-A';
const WU_TEST_ASYNC_B = 'WU-TEST-1251-ASYNC-B';

function createDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createStamp(wuId: string): void {
  createDir(STAMPS_DIR);
  writeFileSync(
    join(STAMPS_DIR, `${wuId}.done`),
    JSON.stringify({ wuId, completedAt: new Date().toISOString() }),
  );
}

function cleanupTestWUs(): void {
  if (existsSync(TEST_WU_DIR)) {
    const files = readdirSync(TEST_WU_DIR);
    for (const file of files) {
      if (file.startsWith('WU-TEST-1251')) {
        rmSync(join(TEST_WU_DIR, file));
      }
    }
  }
}

function cleanupTestStamps(): void {
  if (existsSync(STAMPS_DIR)) {
    const files = readdirSync(STAMPS_DIR);
    for (const file of files) {
      if (file.startsWith('WU-TEST-1251')) {
        rmSync(join(STAMPS_DIR, file));
      }
    }
  }
}

describe('WU-1251: dependencies array support in wave calculation', () => {
  beforeEach(() => {
    cleanupTestWUs();
    cleanupTestStamps();
  });

  afterEach(() => {
    cleanupTestWUs();
    cleanupTestStamps();
  });

  describe('AC1: WUs with dependencies are placed in waves AFTER their dependencies', () => {
    it('should place WU with dependencies in wave after dependency when using dependencies array', () => {
      // WU-A has no dependencies (Wave 0)
      // WU-B depends on WU-A via "dependencies" array (should be Wave 1)
      const wus = [
        {
          id: WU_TEST_A,
          doc: { status: 'ready', lane: LANE_A, blocked_by: [], dependencies: [] },
        },
        {
          id: WU_TEST_B,
          doc: {
            status: 'ready',
            lane: LANE_B,
            blocked_by: [],
            dependencies: [WU_TEST_A],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Should have 2 waves
      expect(plan.waves.length).toBe(2);

      // Wave 0 should only have WU-A
      const wave0Ids = plan.waves[0].map((wu) => wu.id);
      expect(wave0Ids).toContain(WU_TEST_A);
      expect(wave0Ids).not.toContain(WU_TEST_B);

      // Wave 1 should have WU-B
      const wave1Ids = plan.waves[1].map((wu) => wu.id);
      expect(wave1Ids).toContain(WU_TEST_B);
    });

    it('should respect dependencies array even when blocked_by is empty', () => {
      // This is the exact bug scenario: dependencies is set but blocked_by is empty
      const wus = [
        {
          id: WU_TEST_1234,
          doc: { status: 'ready', lane: LANE_MEMORY, blocked_by: [], dependencies: [] },
        },
        {
          id: WU_TEST_1240,
          doc: {
            status: 'ready',
            lane: LANE_CORE,
            blocked_by: [], // Bug: blocked_by is empty
            dependencies: [WU_TEST_1234], // But dependencies has the dep
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Bug scenario: both WUs were placed in Wave 0
      // After fix: WU-1234 should be in Wave 0, WU-1240 should be in Wave 1
      expect(plan.waves.length).toBe(2);

      const wave0Ids = plan.waves[0].map((wu) => wu.id);
      const wave1Ids = plan.waves[1].map((wu) => wu.id);

      expect(wave0Ids).toContain(WU_TEST_1234);
      expect(wave0Ids).not.toContain(WU_TEST_1240);
      expect(wave1Ids).toContain(WU_TEST_1240);
    });

    it('should support chained dependencies via dependencies array', () => {
      // Chain: A -> B -> C (all via dependencies array, not blocked_by)
      const wus = [
        {
          id: WU_TEST_CHAIN_A,
          doc: { status: 'ready', lane: LANE_A, blocked_by: [], dependencies: [] },
        },
        {
          id: WU_TEST_CHAIN_B,
          doc: {
            status: 'ready',
            lane: LANE_B,
            blocked_by: [],
            dependencies: [WU_TEST_CHAIN_A],
          },
        },
        {
          id: WU_TEST_CHAIN_C,
          doc: {
            status: 'ready',
            lane: LANE_C,
            blocked_by: [],
            dependencies: [WU_TEST_CHAIN_B],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Should have 3 waves for the chain
      expect(plan.waves.length).toBe(3);

      // Wave 0: A, Wave 1: B, Wave 2: C
      expect(plan.waves[0].map((wu) => wu.id)).toEqual([WU_TEST_CHAIN_A]);
      expect(plan.waves[1].map((wu) => wu.id)).toEqual([WU_TEST_CHAIN_B]);
      expect(plan.waves[2].map((wu) => wu.id)).toEqual([WU_TEST_CHAIN_C]);
    });

    it('should combine blocked_by and dependencies arrays for dependency resolution', () => {
      // WU-C depends on WU-A via blocked_by AND WU-B via dependencies
      const wus = [
        {
          id: WU_TEST_MIX_A,
          doc: { status: 'ready', lane: LANE_A, blocked_by: [], dependencies: [] },
        },
        {
          id: WU_TEST_MIX_B,
          doc: { status: 'ready', lane: LANE_B, blocked_by: [], dependencies: [] },
        },
        {
          id: WU_TEST_MIX_C,
          doc: {
            status: 'ready',
            lane: LANE_C,
            blocked_by: [WU_TEST_MIX_A],
            dependencies: [WU_TEST_MIX_B],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // A and B can be in Wave 0 (parallel, different lanes)
      // C must be in Wave 1 (depends on both A and B)
      expect(plan.waves.length).toBe(2);

      const wave0Ids = plan.waves[0].map((wu) => wu.id);
      expect(wave0Ids).toContain(WU_TEST_MIX_A);
      expect(wave0Ids).toContain(WU_TEST_MIX_B);

      const wave1Ids = plan.waves[1].map((wu) => wu.id);
      expect(wave1Ids).toContain(WU_TEST_MIX_C);
    });
  });

  describe('AC2: orchestrate:initiative --dry-run shows correct wave structure', () => {
    it('should show separate waves for WUs with dependencies in formatExecutionPlan output', () => {
      const wus = [
        {
          id: WU_TEST_FMT_A,
          doc: {
            status: 'ready',
            lane: LANE_A,
            title: 'Foundation WU',
            blocked_by: [],
            dependencies: [],
          },
        },
        {
          id: WU_TEST_FMT_B,
          doc: {
            status: 'ready',
            lane: LANE_B,
            title: 'Dependent WU',
            blocked_by: [],
            dependencies: [WU_TEST_FMT_A],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);
      const initiative = { id: 'INIT-TEST', title: 'Test Initiative' };
      const output = formatExecutionPlan(initiative, plan);

      // Output should show 2 waves
      expect(output).toContain('Wave 0');
      expect(output).toContain('Wave 1');

      // WU-A should be in Wave 0, WU-B in Wave 1
      const wave0Section = output.split('Wave 1')[0];
      const wave1Section = output.split('Wave 1')[1];

      expect(wave0Section).toContain(WU_TEST_FMT_A);
      expect(wave0Section).not.toContain(WU_TEST_FMT_B);
      expect(wave1Section).toContain(WU_TEST_FMT_B);
    });
  });

  describe('AC3: Dependency deferred handling with dependencies array', () => {
    it('should defer WUs when their dependencies (via dependencies array) have external unstamped blockers', () => {
      // WU-DEP depends on WU-EXT which is not in the initiative and has no stamp
      const wus = [
        {
          id: WU_TEST_DEP,
          doc: {
            status: 'ready',
            lane: LANE_A,
            blocked_by: [],
            dependencies: ['WU-EXTERNAL-NO-STAMP'],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // The WU should be deferred since its dependency has no stamp
      expect(plan.deferred.length).toBeGreaterThan(0);
      expect(plan.deferred.map((d) => d.id)).toContain(WU_TEST_DEP);
    });

    it('should schedule WU when dependency has a stamp', () => {
      // Create stamp for external dependency
      createStamp(WU_TEST_STAMPED);

      const wus = [
        {
          id: WU_TEST_READY_DEP,
          doc: {
            status: 'ready',
            lane: LANE_A,
            blocked_by: [],
            dependencies: [WU_TEST_STAMPED],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // The WU should be scheduled since its dependency has a stamp
      const wuIdsInWaves = plan.waves.flat().map((wu) => wu.id);
      expect(wuIdsInWaves).toContain(WU_TEST_READY_DEP);
    });
  });

  describe('Async version buildExecutionPlanAsync', () => {
    it('should also respect dependencies array in async version', async () => {
      const wus = [
        {
          id: WU_TEST_ASYNC_A,
          doc: { status: 'ready', lane: LANE_A, blocked_by: [], dependencies: [] },
        },
        {
          id: WU_TEST_ASYNC_B,
          doc: {
            status: 'ready',
            lane: LANE_B,
            blocked_by: [],
            dependencies: [WU_TEST_ASYNC_A],
          },
        },
      ];

      const plan = await buildExecutionPlanAsync(wus);

      // Should have 2 waves
      expect(plan.waves.length).toBe(2);

      const wave0Ids = plan.waves[0].map((wu) => wu.id);
      const wave1Ids = plan.waves[1].map((wu) => wu.id);

      expect(wave0Ids).toContain(WU_TEST_ASYNC_A);
      expect(wave1Ids).toContain(WU_TEST_ASYNC_B);
    });
  });
});
