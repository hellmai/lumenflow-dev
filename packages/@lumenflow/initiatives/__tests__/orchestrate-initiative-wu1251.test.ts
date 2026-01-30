/**
 * WU-1251: orchestrate:initiative dependency resolution tests
 *
 * Bug: orchestrate:initiative --dry-run ignores WU dependencies array when building execution plan.
 * WU-1240 has dependencies: [WU-1234] but both are placed in Wave 0.
 * The wave calculation should respect the dependencies array and only place WUs in a wave
 * after all their dependencies are scheduled in earlier waves.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const STAMPS_DIR = '.lumenflow/stamps';
const TEST_WU_DIR = 'docs/04-operations/tasks/wu';

function createDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function createTestWUFile(
  wuId: string,
  options: {
    lane?: string;
    status?: string;
    blockedBy?: string[];
    dependencies?: string[];
  } = {},
): void {
  const { lane = 'Test Lane', status = 'ready', blockedBy = [], dependencies = [] } = options;
  createDir(TEST_WU_DIR);

  const blockedByYaml =
    blockedBy.length > 0 ? '\n' + blockedBy.map((id) => `  - ${id}`).join('\n') : ' []';

  const dependenciesYaml =
    dependencies.length > 0 ? '\n' + dependencies.map((id) => `  - ${id}`).join('\n') : ' []';

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
dependencies:${dependenciesYaml}
blocked_by:${blockedByYaml}
risks: []
notes: ''
requires_review: false
description: Test WU for WU-1251 tests
acceptance:
  - Test passes
`;

  writeFileSync(join(TEST_WU_DIR, `${wuId}.yaml`), yaml);
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
    it('should place WU with dependencies in wave after dependency when using dependencies array', async () => {
      const { buildExecutionPlan } = await import('@lumenflow/initiatives');

      // WU-A has no dependencies (Wave 0)
      // WU-B depends on WU-A via "dependencies" array (should be Wave 1)
      const wus = [
        {
          id: 'WU-TEST-1251-A',
          doc: { status: 'ready', lane: 'Lane A', blocked_by: [], dependencies: [] },
        },
        {
          id: 'WU-TEST-1251-B',
          doc: {
            status: 'ready',
            lane: 'Lane B',
            blocked_by: [],
            dependencies: ['WU-TEST-1251-A'],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Should have 2 waves
      expect(plan.waves.length).toBe(2);

      // Wave 0 should only have WU-A
      const wave0Ids = plan.waves[0].map((wu) => wu.id);
      expect(wave0Ids).toContain('WU-TEST-1251-A');
      expect(wave0Ids).not.toContain('WU-TEST-1251-B');

      // Wave 1 should have WU-B
      const wave1Ids = plan.waves[1].map((wu) => wu.id);
      expect(wave1Ids).toContain('WU-TEST-1251-B');
    });

    it('should respect dependencies array even when blocked_by is empty', async () => {
      const { buildExecutionPlan } = await import('@lumenflow/initiatives');

      // This is the exact bug scenario: dependencies is set but blocked_by is empty
      const wus = [
        {
          id: 'WU-TEST-1251-1234',
          doc: { status: 'ready', lane: 'Framework: Memory', blocked_by: [], dependencies: [] },
        },
        {
          id: 'WU-TEST-1251-1240',
          doc: {
            status: 'ready',
            lane: 'Framework: Core',
            blocked_by: [], // Bug: blocked_by is empty
            dependencies: ['WU-TEST-1251-1234'], // But dependencies has the dep
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Bug scenario: both WUs were placed in Wave 0
      // After fix: WU-1234 should be in Wave 0, WU-1240 should be in Wave 1
      expect(plan.waves.length).toBe(2);

      const wave0Ids = plan.waves[0].map((wu) => wu.id);
      const wave1Ids = plan.waves[1].map((wu) => wu.id);

      expect(wave0Ids).toContain('WU-TEST-1251-1234');
      expect(wave0Ids).not.toContain('WU-TEST-1251-1240');
      expect(wave1Ids).toContain('WU-TEST-1251-1240');
    });

    it('should support chained dependencies via dependencies array', async () => {
      const { buildExecutionPlan } = await import('@lumenflow/initiatives');

      // Chain: A -> B -> C (all via dependencies array, not blocked_by)
      const wus = [
        {
          id: 'WU-TEST-1251-CHAIN-A',
          doc: { status: 'ready', lane: 'Lane A', blocked_by: [], dependencies: [] },
        },
        {
          id: 'WU-TEST-1251-CHAIN-B',
          doc: {
            status: 'ready',
            lane: 'Lane B',
            blocked_by: [],
            dependencies: ['WU-TEST-1251-CHAIN-A'],
          },
        },
        {
          id: 'WU-TEST-1251-CHAIN-C',
          doc: {
            status: 'ready',
            lane: 'Lane C',
            blocked_by: [],
            dependencies: ['WU-TEST-1251-CHAIN-B'],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // Should have 3 waves for the chain
      expect(plan.waves.length).toBe(3);

      // Wave 0: A, Wave 1: B, Wave 2: C
      expect(plan.waves[0].map((wu) => wu.id)).toEqual(['WU-TEST-1251-CHAIN-A']);
      expect(plan.waves[1].map((wu) => wu.id)).toEqual(['WU-TEST-1251-CHAIN-B']);
      expect(plan.waves[2].map((wu) => wu.id)).toEqual(['WU-TEST-1251-CHAIN-C']);
    });

    it('should combine blocked_by and dependencies arrays for dependency resolution', async () => {
      const { buildExecutionPlan } = await import('@lumenflow/initiatives');

      // WU-C depends on WU-A via blocked_by AND WU-B via dependencies
      const wus = [
        {
          id: 'WU-TEST-1251-MIX-A',
          doc: { status: 'ready', lane: 'Lane A', blocked_by: [], dependencies: [] },
        },
        {
          id: 'WU-TEST-1251-MIX-B',
          doc: { status: 'ready', lane: 'Lane B', blocked_by: [], dependencies: [] },
        },
        {
          id: 'WU-TEST-1251-MIX-C',
          doc: {
            status: 'ready',
            lane: 'Lane C',
            blocked_by: ['WU-TEST-1251-MIX-A'],
            dependencies: ['WU-TEST-1251-MIX-B'],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // A and B can be in Wave 0 (parallel, different lanes)
      // C must be in Wave 1 (depends on both A and B)
      expect(plan.waves.length).toBe(2);

      const wave0Ids = plan.waves[0].map((wu) => wu.id);
      expect(wave0Ids).toContain('WU-TEST-1251-MIX-A');
      expect(wave0Ids).toContain('WU-TEST-1251-MIX-B');

      const wave1Ids = plan.waves[1].map((wu) => wu.id);
      expect(wave1Ids).toContain('WU-TEST-1251-MIX-C');
    });
  });

  describe('AC2: orchestrate:initiative --dry-run shows correct wave structure', () => {
    it('should show separate waves for WUs with dependencies in formatExecutionPlan output', async () => {
      const { buildExecutionPlan, formatExecutionPlan } = await import('@lumenflow/initiatives');

      const wus = [
        {
          id: 'WU-TEST-1251-FMT-A',
          doc: {
            status: 'ready',
            lane: 'Lane A',
            title: 'Foundation WU',
            blocked_by: [],
            dependencies: [],
          },
        },
        {
          id: 'WU-TEST-1251-FMT-B',
          doc: {
            status: 'ready',
            lane: 'Lane B',
            title: 'Dependent WU',
            blocked_by: [],
            dependencies: ['WU-TEST-1251-FMT-A'],
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

      expect(wave0Section).toContain('WU-TEST-1251-FMT-A');
      expect(wave0Section).not.toContain('WU-TEST-1251-FMT-B');
      expect(wave1Section).toContain('WU-TEST-1251-FMT-B');
    });
  });

  describe('AC3: Dependency deferred handling with dependencies array', () => {
    it('should defer WUs when their dependencies (via dependencies array) have external unstamped blockers', async () => {
      const { buildExecutionPlan } = await import('@lumenflow/initiatives');

      // WU-DEP depends on WU-EXT which is not in the initiative and has no stamp
      const wus = [
        {
          id: 'WU-TEST-1251-DEP',
          doc: {
            status: 'ready',
            lane: 'Lane A',
            blocked_by: [],
            dependencies: ['WU-EXTERNAL-NO-STAMP'],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // The WU should be deferred since its dependency has no stamp
      expect(plan.deferred.length).toBeGreaterThan(0);
      expect(plan.deferred.map((d) => d.id)).toContain('WU-TEST-1251-DEP');
    });

    it('should schedule WU when dependency has a stamp', async () => {
      // Create stamp for external dependency
      createStamp('WU-TEST-1251-STAMPED');

      const { buildExecutionPlan } = await import('@lumenflow/initiatives');

      const wus = [
        {
          id: 'WU-TEST-1251-READY-DEP',
          doc: {
            status: 'ready',
            lane: 'Lane A',
            blocked_by: [],
            dependencies: ['WU-TEST-1251-STAMPED'],
          },
        },
      ];

      const plan = buildExecutionPlan(wus);

      // The WU should be scheduled since its dependency has a stamp
      const wuIdsInWaves = plan.waves.flat().map((wu) => wu.id);
      expect(wuIdsInWaves).toContain('WU-TEST-1251-READY-DEP');
    });
  });

  describe('Async version buildExecutionPlanAsync', () => {
    it('should also respect dependencies array in async version', async () => {
      const { buildExecutionPlanAsync } = await import('@lumenflow/initiatives');

      const wus = [
        {
          id: 'WU-TEST-1251-ASYNC-A',
          doc: { status: 'ready', lane: 'Lane A', blocked_by: [], dependencies: [] },
        },
        {
          id: 'WU-TEST-1251-ASYNC-B',
          doc: {
            status: 'ready',
            lane: 'Lane B',
            blocked_by: [],
            dependencies: ['WU-TEST-1251-ASYNC-A'],
          },
        },
      ];

      const plan = await buildExecutionPlanAsync(wus);

      // Should have 2 waves
      expect(plan.waves.length).toBe(2);

      const wave0Ids = plan.waves[0].map((wu) => wu.id);
      const wave1Ids = plan.waves[1].map((wu) => wu.id);

      expect(wave0Ids).toContain('WU-TEST-1251-ASYNC-A');
      expect(wave1Ids).toContain('WU-TEST-1251-ASYNC-B');
    });
  });
});
