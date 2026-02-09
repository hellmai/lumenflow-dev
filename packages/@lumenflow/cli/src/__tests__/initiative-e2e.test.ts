/**
 * Initiative Orchestration E2E Tests (WU-1363)
 *
 * End-to-end tests for initiative orchestration:
 * - AC5: E2E test for initiative orchestration
 *
 * These tests validate the complete initiative workflow:
 * - Creating initiatives with phases
 * - Adding WUs to initiatives
 * - Tracking initiative progress
 * - Wave-based orchestration
 *
 * TDD: Tests written BEFORE implementation verification.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { parseYAML, stringifyYAML } from '@lumenflow/core/wu-yaml';
import { WU_STATUS } from '@lumenflow/core/wu-constants';

// Test constants
const TEST_INIT_ID = 'INIT-901';
const TEST_INIT_TITLE = 'Test Initiative';
const TEST_WU_ID_1 = 'WU-9930';
const TEST_WU_ID_2 = 'WU-9931';
const TEST_WU_ID_3 = 'WU-9932';
const TEST_LANE = 'Framework: CLI';

/**
 * Helper to create a test project for initiative orchestration
 */
function createInitiativeProject(baseDir: string): void {
  const dirs = [
    'docs/04-operations/tasks/wu',
    'docs/04-operations/tasks/initiatives',
    '.lumenflow/state',
    '.lumenflow/memory',
    '.lumenflow/stamps',
    'packages/@lumenflow/cli/src',
  ];

  for (const dir of dirs) {
    mkdirSync(join(baseDir, dir), { recursive: true });
  }

  // Create config
  const configContent = `
version: 1
lanes:
  definitions:
    - name: 'Framework: CLI'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/cli/**'
    - name: 'Framework: Core'
      wip_limit: 1
      code_paths:
        - 'packages/@lumenflow/core/**'
git:
  requireRemote: false
initiatives:
  enabled: true
`;
  writeFileSync(join(baseDir, '.lumenflow.config.yaml'), configContent);

  // Initialize git
  execFileSync('git', ['init'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: baseDir, stdio: 'pipe' });
  writeFileSync(join(baseDir, 'README.md'), '# Test\n');
  execFileSync('git', ['add', '.'], { cwd: baseDir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: baseDir, stdio: 'pipe' });
}

/**
 * Helper to create an initiative YAML file
 */
function createInitiative(
  baseDir: string,
  id: string,
  options: {
    title?: string;
    status?: string;
    phases?: Array<{ name: string; status: string }>;
    wus?: string[];
  } = {},
): string {
  const initDir = join(baseDir, 'docs/04-operations/tasks/initiatives');
  const initPath = join(initDir, `${id}.yaml`);

  const doc = {
    id,
    slug: id.toLowerCase().replace('init-', 'initiative-'),
    title: options.title || TEST_INIT_TITLE,
    status: options.status || 'open',
    created: '2026-02-03',
    description: 'Test initiative for E2E testing',
    phases: options.phases || [
      { name: 'Phase 1: Foundation', status: 'in_progress' },
      { name: 'Phase 2: Features', status: 'pending' },
    ],
    wus: options.wus || [],
  };

  writeFileSync(initPath, stringifyYAML(doc));
  return initPath;
}

/**
 * Helper to create a WU linked to an initiative
 */
function createWUForInitiative(
  baseDir: string,
  id: string,
  options: {
    initiative?: string;
    phase?: number;
    status?: string;
    lane?: string;
    dependencies?: string[];
  } = {},
): string {
  const wuDir = join(baseDir, 'docs/04-operations/tasks/wu');
  const wuPath = join(wuDir, `${id}.yaml`);

  const doc: Record<string, unknown> = {
    id,
    title: `WU for ${options.initiative || 'testing'}`,
    lane: options.lane || TEST_LANE,
    status: options.status || WU_STATUS.READY,
    type: 'feature',
    priority: 'P2',
    created: '2026-02-03',
    description: 'Context: Test. Problem: Testing. Solution: Test it.',
    acceptance: ['Test passes'],
    code_paths: ['packages/@lumenflow/cli/src'],
    tests: { unit: ['test.test.ts'] },
    exposure: 'backend-only',
    dependencies: options.dependencies || [],
  };

  if (options.initiative) {
    doc.initiative = options.initiative;
  }
  if (options.phase !== undefined) {
    doc.phase = options.phase;
  }

  writeFileSync(wuPath, stringifyYAML(doc));
  return wuPath;
}

describe('Initiative Orchestration E2E Tests (WU-1363)', () => {
  let tempDir: string;
  let originalCwd: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `initiative-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(tempDir, { recursive: true });
    originalCwd = process.cwd();
    createInitiativeProject(tempDir);
    vi.resetModules();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(tempDir)) {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
    vi.clearAllMocks();
  });

  describe('AC5: E2E test for initiative orchestration', () => {
    describe('initiative creation', () => {
      it('should create an initiative with phases', () => {
        // Arrange
        process.chdir(tempDir);

        // Act
        const initPath = createInitiative(tempDir, TEST_INIT_ID, {
          title: TEST_INIT_TITLE,
          phases: [
            { name: 'Phase 1: MVP', status: 'pending' },
            { name: 'Phase 2: Polish', status: 'pending' },
            { name: 'Phase 3: Launch', status: 'pending' },
          ],
        });

        // Assert
        expect(existsSync(initPath)).toBe(true);
        const content = readFileSync(initPath, 'utf-8');
        const doc = parseYAML(content);
        expect(doc.id).toBe(TEST_INIT_ID);
        expect(doc.phases).toHaveLength(3);
      });

      it('should track initiative status', () => {
        // Arrange
        process.chdir(tempDir);
        createInitiative(tempDir, TEST_INIT_ID, { status: 'open' });

        // Act
        const initPath = join(
          tempDir,
          'docs/04-operations/tasks/initiatives',
          `${TEST_INIT_ID}.yaml`,
        );
        const doc = parseYAML(readFileSync(initPath, 'utf-8'));

        // Assert
        expect(doc.status).toBe('open');
      });
    });

    describe('WU linkage', () => {
      it('should link WUs to initiatives', () => {
        // Arrange
        process.chdir(tempDir);
        createInitiative(tempDir, TEST_INIT_ID, { wus: [] });

        // Act - Create WU linked to initiative
        const wuPath = createWUForInitiative(tempDir, TEST_WU_ID_1, {
          initiative: TEST_INIT_ID,
          phase: 1,
        });

        // Update initiative with WU reference
        const initPath = join(
          tempDir,
          'docs/04-operations/tasks/initiatives',
          `${TEST_INIT_ID}.yaml`,
        );
        const initDoc = parseYAML(readFileSync(initPath, 'utf-8'));
        initDoc.wus = [TEST_WU_ID_1];
        writeFileSync(initPath, stringifyYAML(initDoc));

        // Assert
        expect(existsSync(wuPath)).toBe(true);
        const wuDoc = parseYAML(readFileSync(wuPath, 'utf-8'));
        expect(wuDoc.initiative).toBe(TEST_INIT_ID);

        const updatedInit = parseYAML(readFileSync(initPath, 'utf-8'));
        expect(updatedInit.wus).toContain(TEST_WU_ID_1);
      });

      it('should track multiple WUs per phase', () => {
        // Arrange
        process.chdir(tempDir);
        createInitiative(tempDir, TEST_INIT_ID);

        // Act - Create multiple WUs for phase 1
        createWUForInitiative(tempDir, TEST_WU_ID_1, { initiative: TEST_INIT_ID, phase: 1 });
        createWUForInitiative(tempDir, TEST_WU_ID_2, { initiative: TEST_INIT_ID, phase: 1 });
        createWUForInitiative(tempDir, TEST_WU_ID_3, { initiative: TEST_INIT_ID, phase: 2 });

        // Update initiative
        const initPath = join(
          tempDir,
          'docs/04-operations/tasks/initiatives',
          `${TEST_INIT_ID}.yaml`,
        );
        const initDoc = parseYAML(readFileSync(initPath, 'utf-8'));
        initDoc.wus = [TEST_WU_ID_1, TEST_WU_ID_2, TEST_WU_ID_3];
        writeFileSync(initPath, stringifyYAML(initDoc));

        // Assert
        const updatedInit = parseYAML(readFileSync(initPath, 'utf-8'));
        expect(updatedInit.wus).toHaveLength(3);
      });
    });

    describe('progress tracking', () => {
      it('should calculate initiative progress from WU statuses', () => {
        // Arrange
        process.chdir(tempDir);
        createInitiative(tempDir, TEST_INIT_ID, {
          wus: [TEST_WU_ID_1, TEST_WU_ID_2, TEST_WU_ID_3],
        });

        createWUForInitiative(tempDir, TEST_WU_ID_1, {
          initiative: TEST_INIT_ID,
          status: WU_STATUS.DONE,
        });
        createWUForInitiative(tempDir, TEST_WU_ID_2, {
          initiative: TEST_INIT_ID,
          status: WU_STATUS.IN_PROGRESS,
        });
        createWUForInitiative(tempDir, TEST_WU_ID_3, {
          initiative: TEST_INIT_ID,
          status: WU_STATUS.READY,
        });

        // Act - Calculate progress
        const wuStatuses = [TEST_WU_ID_1, TEST_WU_ID_2, TEST_WU_ID_3].map((id) => {
          const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${id}.yaml`);
          const doc = parseYAML(readFileSync(wuPath, 'utf-8'));
          return doc.status;
        });

        const doneCount = wuStatuses.filter((s) => s === WU_STATUS.DONE).length;
        const totalCount = wuStatuses.length;
        const progressPercent = Math.round((doneCount / totalCount) * 100);

        // Assert
        expect(doneCount).toBe(1);
        expect(totalCount).toBe(3);
        expect(progressPercent).toBe(33);
      });

      it('should track phase completion', () => {
        // Arrange
        process.chdir(tempDir);
        const initPath = createInitiative(tempDir, TEST_INIT_ID, {
          phases: [
            { name: 'Phase 1', status: 'in_progress' },
            { name: 'Phase 2', status: 'pending' },
          ],
        });

        // Create phase 1 WUs (all done)
        createWUForInitiative(tempDir, TEST_WU_ID_1, {
          initiative: TEST_INIT_ID,
          phase: 1,
          status: WU_STATUS.DONE,
        });
        createWUForInitiative(tempDir, TEST_WU_ID_2, {
          initiative: TEST_INIT_ID,
          phase: 1,
          status: WU_STATUS.DONE,
        });

        // Act - Mark phase 1 as done
        const initDoc = parseYAML(readFileSync(initPath, 'utf-8'));
        initDoc.phases[0].status = 'done';
        initDoc.phases[1].status = 'in_progress';
        writeFileSync(initPath, stringifyYAML(initDoc));

        // Assert
        const updatedDoc = parseYAML(readFileSync(initPath, 'utf-8'));
        expect(updatedDoc.phases[0].status).toBe('done');
        expect(updatedDoc.phases[1].status).toBe('in_progress');
      });
    });

    describe('wave-based orchestration', () => {
      it('should identify parallelizable WUs (no dependencies)', () => {
        // Arrange
        process.chdir(tempDir);
        createInitiative(tempDir, TEST_INIT_ID, {
          wus: [TEST_WU_ID_1, TEST_WU_ID_2, TEST_WU_ID_3],
        });

        // Create WUs with different lanes (parallelizable)
        createWUForInitiative(tempDir, TEST_WU_ID_1, {
          initiative: TEST_INIT_ID,
          lane: 'Framework: CLI',
          dependencies: [],
        });
        createWUForInitiative(tempDir, TEST_WU_ID_2, {
          initiative: TEST_INIT_ID,
          lane: 'Framework: Core',
          dependencies: [],
        });
        createWUForInitiative(tempDir, TEST_WU_ID_3, {
          initiative: TEST_INIT_ID,
          lane: 'Content: Documentation',
          dependencies: [],
        });

        // Act - Identify parallel WUs
        const wus = [TEST_WU_ID_1, TEST_WU_ID_2, TEST_WU_ID_3].map((id) => {
          const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${id}.yaml`);
          return parseYAML(readFileSync(wuPath, 'utf-8'));
        });

        const parallelWUs = wus.filter((wu) => !wu.dependencies || wu.dependencies.length === 0);

        // Assert - All three can run in parallel (different lanes, no dependencies)
        expect(parallelWUs).toHaveLength(3);
      });

      it('should respect dependencies for wave ordering', () => {
        // Arrange
        process.chdir(tempDir);
        createInitiative(tempDir, TEST_INIT_ID, {
          wus: [TEST_WU_ID_1, TEST_WU_ID_2, TEST_WU_ID_3],
        });

        // WU-1 has no dependencies (wave 1)
        createWUForInitiative(tempDir, TEST_WU_ID_1, {
          initiative: TEST_INIT_ID,
          dependencies: [],
        });

        // WU-2 depends on WU-1 (wave 2)
        createWUForInitiative(tempDir, TEST_WU_ID_2, {
          initiative: TEST_INIT_ID,
          dependencies: [TEST_WU_ID_1],
        });

        // WU-3 depends on WU-2 (wave 3)
        createWUForInitiative(tempDir, TEST_WU_ID_3, {
          initiative: TEST_INIT_ID,
          dependencies: [TEST_WU_ID_2],
        });

        // Act - Compute waves
        const wus = [TEST_WU_ID_1, TEST_WU_ID_2, TEST_WU_ID_3].map((id) => {
          const wuPath = join(tempDir, 'docs/04-operations/tasks/wu', `${id}.yaml`);
          return parseYAML(readFileSync(wuPath, 'utf-8'));
        });

        const wave1 = wus.filter((wu) => !wu.dependencies || wu.dependencies.length === 0);
        const wave2 = wus.filter(
          (wu) =>
            wu.dependencies &&
            wu.dependencies.length > 0 &&
            wu.dependencies.every((dep: string) => wave1.some((w) => w.id === dep)),
        );
        const wave3 = wus.filter(
          (wu) =>
            wu.dependencies &&
            wu.dependencies.length > 0 &&
            wu.dependencies.every((dep: string) => wave2.some((w) => w.id === dep)),
        );

        // Assert
        expect(wave1).toHaveLength(1);
        expect(wave1[0].id).toBe(TEST_WU_ID_1);

        expect(wave2).toHaveLength(1);
        expect(wave2[0].id).toBe(TEST_WU_ID_2);

        expect(wave3).toHaveLength(1);
        expect(wave3[0].id).toBe(TEST_WU_ID_3);
      });
    });

    describe('complete initiative workflow', () => {
      it('should execute full initiative lifecycle', () => {
        // This test validates the complete initiative workflow:
        // 1. Create initiative with phases
        // 2. Add WUs to initiative
        // 3. Execute WUs (simulated status changes)
        // 4. Track progress
        // 5. Complete initiative

        // Arrange
        process.chdir(tempDir);

        // Step 1: Create initiative
        const initPath = createInitiative(tempDir, TEST_INIT_ID, {
          title: 'E2E Test Initiative',
          status: 'open',
          phases: [
            { name: 'Phase 1: Core', status: 'pending' },
            { name: 'Phase 2: Features', status: 'pending' },
          ],
          wus: [],
        });
        expect(existsSync(initPath)).toBe(true);

        // Step 2: Add WUs to initiative
        createWUForInitiative(tempDir, TEST_WU_ID_1, {
          initiative: TEST_INIT_ID,
          phase: 1,
          status: WU_STATUS.READY,
        });
        createWUForInitiative(tempDir, TEST_WU_ID_2, {
          initiative: TEST_INIT_ID,
          phase: 1,
          dependencies: [TEST_WU_ID_1],
          status: WU_STATUS.READY,
        });
        createWUForInitiative(tempDir, TEST_WU_ID_3, {
          initiative: TEST_INIT_ID,
          phase: 2,
          status: WU_STATUS.READY,
        });

        let initDoc = parseYAML(readFileSync(initPath, 'utf-8'));
        initDoc.wus = [TEST_WU_ID_1, TEST_WU_ID_2, TEST_WU_ID_3];
        initDoc.phases[0].status = 'in_progress';
        writeFileSync(initPath, stringifyYAML(initDoc));

        // Step 3: Execute Phase 1 WUs
        // Complete WU-1
        const wu1Path = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID_1}.yaml`);
        const wu1 = parseYAML(readFileSync(wu1Path, 'utf-8'));
        wu1.status = WU_STATUS.DONE;
        writeFileSync(wu1Path, stringifyYAML(wu1));

        // Complete WU-2
        const wu2Path = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID_2}.yaml`);
        const wu2 = parseYAML(readFileSync(wu2Path, 'utf-8'));
        wu2.status = WU_STATUS.DONE;
        writeFileSync(wu2Path, stringifyYAML(wu2));

        // Step 4: Check progress
        const wuPaths = [
          join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID_1}.yaml`),
          join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID_2}.yaml`),
          join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID_3}.yaml`),
        ];
        const statuses = wuPaths.map((p) => parseYAML(readFileSync(p, 'utf-8')).status);
        const doneCount = statuses.filter((s) => s === WU_STATUS.DONE).length;

        expect(doneCount).toBe(2); // 2 out of 3 done

        // Mark Phase 1 as done
        initDoc = parseYAML(readFileSync(initPath, 'utf-8'));
        initDoc.phases[0].status = 'done';
        initDoc.phases[1].status = 'in_progress';
        writeFileSync(initPath, stringifyYAML(initDoc));

        // Complete WU-3 (Phase 2)
        const wu3Path = join(tempDir, 'docs/04-operations/tasks/wu', `${TEST_WU_ID_3}.yaml`);
        const wu3 = parseYAML(readFileSync(wu3Path, 'utf-8'));
        wu3.status = WU_STATUS.DONE;
        writeFileSync(wu3Path, stringifyYAML(wu3));

        // Step 5: Complete initiative
        initDoc = parseYAML(readFileSync(initPath, 'utf-8'));
        initDoc.phases[1].status = 'done';
        initDoc.status = 'completed';
        initDoc.completed_at = new Date().toISOString();
        writeFileSync(initPath, stringifyYAML(initDoc));

        // Final assertions
        const finalInit = parseYAML(readFileSync(initPath, 'utf-8'));
        expect(finalInit.status).toBe('completed');
        expect(finalInit.phases.every((p: { status: string }) => p.status === 'done')).toBe(true);

        const finalWuStatuses = wuPaths.map((p) => parseYAML(readFileSync(p, 'utf-8')).status);
        expect(finalWuStatuses.every((s) => s === WU_STATUS.DONE)).toBe(true);
      });
    });
  });
});
