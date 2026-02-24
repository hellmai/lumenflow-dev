/**
 * @file lane-health.test.ts
 * Tests for lane:health CLI command (WU-1188)
 *
 * TDD: RED phase - Tests written BEFORE implementation
 *
 * Acceptance Criteria:
 * - pnpm lane:health runs and outputs formatted report
 * - Detects overlapping code_paths between lane definitions
 * - Detects files not covered by any lane
 * - Exit code 0 for healthy, 1 for issues
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Test constants - avoid duplicate string lint errors
const LANE_FRAMEWORK_CORE = 'Framework: Core';
const LANE_FRAMEWORK_CLI = 'Framework: CLI';
const LANE_CONTENT_DOCS = 'Content: Documentation';
const PATH_CORE = 'packages/@lumenflow/core/**';
const PATH_CLI = 'packages/@lumenflow/cli/**';
const PATH_LUMENFLOW_ALL = 'packages/@lumenflow/**';
const PATH_DOCS = 'docs/**';
const FILE_CORE_INDEX = 'packages/@lumenflow/core/src/index.ts';
const FILE_CLI_INDEX = 'packages/@lumenflow/cli/src/index.ts';
const FILE_WEB_PAGE = 'apps/web/src/page.tsx';
const FILE_TOOLS_BUILD = 'tools/scripts/build.ts';
const TEST_PROJECT_ROOT = '/test/project';
const REPORT_TITLE = 'Lane Health Report';
const TEMP_PROJECT_PREFIX = 'lane-health-test-';
const FIXTURE_FILE_CONTENT = '// lane-health fixture\n';
const MKDIR_RECURSIVE_OPTIONS = { recursive: true } as const;
const RM_RECURSIVE_FORCE_OPTIONS = { recursive: true, force: true } as const;

// Mock fs module for testing
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

vi.mock('@lumenflow/core/config', async () => {
  return {
    GIT_DIRECTORY_NAME: '.git',
    WORKSPACE_CONFIG_FILE_NAME: 'workspace.yaml',
    findProjectRoot: vi.fn(() => TEST_PROJECT_ROOT),
    getConfig: vi.fn(),
  };
});

vi.mock('../dist/cli-entry-point.js', () => ({
  runCLI: vi.fn(),
}));

function createProjectFixture(filePaths: readonly string[]): string {
  const projectRoot = mkdtempSync(path.join(tmpdir(), TEMP_PROJECT_PREFIX));

  for (const relativePath of filePaths) {
    const absolutePath = path.join(projectRoot, relativePath);
    mkdirSync(path.dirname(absolutePath), MKDIR_RECURSIVE_OPTIONS);
    writeFileSync(absolutePath, FIXTURE_FILE_CONTENT);
  }

  return projectRoot;
}

function cleanupProjectFixture(projectRoot: string): void {
  rmSync(projectRoot, RM_RECURSIVE_FORCE_OPTIONS);
}

describe('lane:health CLI (WU-1188)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('detectLaneOverlaps', () => {
    it('detects overlapping code_paths between two lanes', async () => {
      const { detectLaneOverlaps } = await import('../dist/lane-health.js');

      const lanes = [
        { name: LANE_FRAMEWORK_CORE, code_paths: [PATH_CORE] },
        { name: LANE_FRAMEWORK_CLI, code_paths: [PATH_LUMENFLOW_ALL] },
      ];

      const result = detectLaneOverlaps(lanes);

      expect(result.hasOverlaps).toBe(true);
      expect(result.overlaps.length).toBeGreaterThan(0);
      expect(result.overlaps[0]).toMatchObject({
        lanes: expect.arrayContaining([LANE_FRAMEWORK_CORE, LANE_FRAMEWORK_CLI]),
      });
    });

    it('returns no overlaps for non-overlapping lanes', async () => {
      const { detectLaneOverlaps } = await import('../dist/lane-health.js');

      const lanes = [
        { name: LANE_FRAMEWORK_CORE, code_paths: [PATH_CORE] },
        { name: LANE_CONTENT_DOCS, code_paths: [PATH_DOCS] },
      ];

      const result = detectLaneOverlaps(lanes);

      expect(result.hasOverlaps).toBe(false);
      expect(result.overlaps).toEqual([]);
    });

    it('detects multiple overlaps', async () => {
      const { detectLaneOverlaps } = await import('../dist/lane-health.js');

      const lanes = [
        { name: 'Lane A', code_paths: ['src/**'] },
        { name: 'Lane B', code_paths: ['src/lib/**'] },
        { name: 'Lane C', code_paths: ['src/util/**'] },
      ];

      const result = detectLaneOverlaps(lanes);

      expect(result.hasOverlaps).toBe(true);
      // Lane A overlaps with both B and C
      expect(result.overlaps.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('detectCoverageGaps', () => {
    it('detects files not covered by any lane', async () => {
      const { detectCoverageGaps } = await import('../dist/lane-health.js');

      const lanes = [
        { name: LANE_FRAMEWORK_CORE, code_paths: [PATH_CORE] },
        { name: LANE_FRAMEWORK_CLI, code_paths: [PATH_CLI] },
      ];

      const projectRoot = createProjectFixture([
        FILE_CORE_INDEX,
        FILE_CLI_INDEX,
        FILE_WEB_PAGE,
        FILE_TOOLS_BUILD,
      ]);

      try {
        const result = detectCoverageGaps(lanes, {
          projectRoot,
          excludePatterns: ['node_modules/**', '.git/**'],
        });

        expect(result.hasGaps).toBe(true);
        expect(result.uncoveredFiles).toContain(FILE_WEB_PAGE);
        expect(result.uncoveredFiles).toContain(FILE_TOOLS_BUILD);
      } finally {
        cleanupProjectFixture(projectRoot);
      }
    });

    it('returns no gaps when all files are covered', async () => {
      const { detectCoverageGaps } = await import('../dist/lane-health.js');

      const lanes = [
        { name: LANE_FRAMEWORK_CORE, code_paths: [PATH_CORE] },
        { name: LANE_FRAMEWORK_CLI, code_paths: [PATH_CLI] },
      ];

      const projectRoot = createProjectFixture([FILE_CORE_INDEX, FILE_CLI_INDEX]);

      try {
        const result = detectCoverageGaps(lanes, {
          projectRoot,
          excludePatterns: ['node_modules/**'],
        });

        expect(result.hasGaps).toBe(false);
        expect(result.uncoveredFiles).toEqual([]);
      } finally {
        cleanupProjectFixture(projectRoot);
      }
    });

    it('remains deterministic after prior unmocked module import', async () => {
      vi.resetModules();
      const firstLoad = await import('../dist/lane-health.js');
      const secondLoad = await import('../dist/lane-health.js');

      const lanes = [
        { name: LANE_FRAMEWORK_CORE, code_paths: [PATH_CORE] },
        { name: LANE_FRAMEWORK_CLI, code_paths: [PATH_CLI] },
      ];

      const projectRoot = createProjectFixture([
        FILE_CORE_INDEX,
        FILE_CLI_INDEX,
        FILE_WEB_PAGE,
        FILE_TOOLS_BUILD,
      ]);

      try {
        const firstResult = firstLoad.detectCoverageGaps(lanes, {
          projectRoot,
          excludePatterns: ['node_modules/**', '.git/**'],
        });

        const secondResult = secondLoad.detectCoverageGaps(lanes, {
          projectRoot,
          excludePatterns: ['node_modules/**', '.git/**'],
        });

        expect(firstResult.hasGaps).toBe(true);
        expect(secondResult.hasGaps).toBe(true);
        expect(secondResult.uncoveredFiles).toContain(FILE_WEB_PAGE);
        expect(secondResult.uncoveredFiles).toContain(FILE_TOOLS_BUILD);
        expect(secondResult).toEqual(firstResult);
      } finally {
        cleanupProjectFixture(projectRoot);
      }
    });
  });

  describe('formatLaneHealthReport', () => {
    it('formats report with overlaps section', async () => {
      const { formatLaneHealthReport } = await import('../dist/lane-health.js');

      const report = {
        overlaps: {
          hasOverlaps: true,
          overlaps: [
            {
              lanes: [LANE_FRAMEWORK_CORE, LANE_FRAMEWORK_CLI],
              pattern: PATH_LUMENFLOW_ALL,
              files: [FILE_CORE_INDEX],
            },
          ],
        },
        gaps: {
          hasGaps: false,
          uncoveredFiles: [],
        },
        healthy: false,
      };

      const output = formatLaneHealthReport(report);

      expect(output).toContain(REPORT_TITLE);
      expect(output).toContain('Overlapping Code Paths');
      expect(output).toContain(LANE_FRAMEWORK_CORE);
      expect(output).toContain(LANE_FRAMEWORK_CLI);
    });

    it('formats report with coverage gaps section', async () => {
      const { formatLaneHealthReport } = await import('../dist/lane-health.js');

      const report = {
        overlaps: {
          hasOverlaps: false,
          overlaps: [],
        },
        gaps: {
          hasGaps: true,
          uncoveredFiles: [FILE_WEB_PAGE, 'tools/build.ts'],
        },
        healthy: false,
      };

      const output = formatLaneHealthReport(report);

      expect(output).toContain(REPORT_TITLE);
      expect(output).toContain('Coverage Gaps');
      expect(output).toContain(FILE_WEB_PAGE);
      expect(output).toContain('tools/build.ts');
    });

    it('formats healthy report', async () => {
      const { formatLaneHealthReport } = await import('../dist/lane-health.js');

      const report = {
        overlaps: {
          hasOverlaps: false,
          overlaps: [],
        },
        gaps: {
          hasGaps: false,
          uncoveredFiles: [],
        },
        healthy: true,
      };

      const output = formatLaneHealthReport(report);

      expect(output).toContain(REPORT_TITLE);
      expect(output).toContain('healthy');
    });
  });

  describe('getExitCode', () => {
    it('returns 0 for healthy report', async () => {
      const { getExitCode } = await import('../dist/lane-health.js');

      const report = {
        overlaps: { hasOverlaps: false, overlaps: [] },
        gaps: { hasGaps: false, uncoveredFiles: [] },
        healthy: true,
      };

      expect(getExitCode(report)).toBe(0);
    });

    it('returns 1 when overlaps detected', async () => {
      const { getExitCode } = await import('../dist/lane-health.js');

      const report = {
        overlaps: {
          hasOverlaps: true,
          overlaps: [{ lanes: ['A', 'B'], pattern: 'src/**', files: [] }],
        },
        gaps: { hasGaps: false, uncoveredFiles: [] },
        healthy: false,
      };

      expect(getExitCode(report)).toBe(1);
    });

    it('returns 1 when coverage gaps detected', async () => {
      const { getExitCode } = await import('../dist/lane-health.js');

      const report = {
        overlaps: { hasOverlaps: false, overlaps: [] },
        gaps: { hasGaps: true, uncoveredFiles: ['some/file.ts'] },
        healthy: false,
      };

      expect(getExitCode(report)).toBe(1);
    });
  });

  describe('loadLaneDefinitions', () => {
    it('loads lane definitions from config file', async () => {
      const coreConfig = await import('@lumenflow/core/config');
      const configMock = coreConfig as { getConfig: ReturnType<typeof vi.fn> };
      configMock.getConfig.mockReturnValue({
        lanes: {
          definitions: [
            { name: LANE_FRAMEWORK_CORE, wip_limit: 1, code_paths: [PATH_CORE] },
            { name: LANE_FRAMEWORK_CLI, wip_limit: 1, code_paths: [PATH_CLI] },
          ],
        },
      });

      const { loadLaneDefinitions } = await import('../dist/lane-health.js');

      const lanes = loadLaneDefinitions(TEST_PROJECT_ROOT);

      expect(lanes.length).toBe(2);
      expect(lanes[0].name).toBe(LANE_FRAMEWORK_CORE);
      expect(lanes[0].code_paths).toEqual([PATH_CORE]);
      expect(lanes[1].name).toBe(LANE_FRAMEWORK_CLI);
    });

    it('returns empty array when no config file exists', async () => {
      const coreConfig = await import('@lumenflow/core/config');
      const configMock = coreConfig as { getConfig: ReturnType<typeof vi.fn> };
      configMock.getConfig.mockImplementation(() => {
        throw new Error('workspace config missing');
      });

      const { loadLaneDefinitions } = await import('../dist/lane-health.js');

      const lanes = loadLaneDefinitions(TEST_PROJECT_ROOT);

      expect(lanes).toEqual([]);
    });
  });
});
