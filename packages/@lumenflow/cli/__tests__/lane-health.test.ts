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

// Mock fs module for testing
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    readFileSync: vi.fn(),
    existsSync: vi.fn(),
  };
});

// Mock fast-glob
vi.mock('fast-glob', () => ({
  default: {
    sync: vi.fn(),
  },
}));

describe('lane:health CLI (WU-1188)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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
      const fg = await import('fast-glob');
      const fgMock = fg.default as { sync: ReturnType<typeof vi.fn> };

      // Mock returns different results based on pattern
      fgMock.sync.mockImplementation((pattern: string) => {
        if (pattern.includes('*.{')) {
          return [FILE_CORE_INDEX, FILE_CLI_INDEX, FILE_WEB_PAGE, FILE_TOOLS_BUILD];
        } else if (pattern.includes('packages/@lumenflow/core')) {
          return [FILE_CORE_INDEX];
        } else if (pattern.includes('packages/@lumenflow/cli')) {
          return [FILE_CLI_INDEX];
        }
        return [];
      });

      const { detectCoverageGaps } = await import('../dist/lane-health.js');

      const lanes = [
        { name: LANE_FRAMEWORK_CORE, code_paths: [PATH_CORE] },
        { name: LANE_FRAMEWORK_CLI, code_paths: [PATH_CLI] },
      ];

      const result = detectCoverageGaps(lanes, {
        projectRoot: TEST_PROJECT_ROOT,
        excludePatterns: ['node_modules/**', '.git/**'],
      });

      expect(result.hasGaps).toBe(true);
      expect(result.uncoveredFiles).toContain(FILE_WEB_PAGE);
      expect(result.uncoveredFiles).toContain(FILE_TOOLS_BUILD);
    });

    it('returns no gaps when all files are covered', async () => {
      const fg = await import('fast-glob');
      const fgMock = fg.default as { sync: ReturnType<typeof vi.fn> };

      // All files are covered by the lanes
      fgMock.sync.mockImplementation((pattern: string) => {
        if (pattern.includes('*.{')) {
          return [FILE_CORE_INDEX, FILE_CLI_INDEX];
        } else if (pattern.includes('packages/@lumenflow/core')) {
          return [FILE_CORE_INDEX];
        } else if (pattern.includes('packages/@lumenflow/cli')) {
          return [FILE_CLI_INDEX];
        }
        return [];
      });

      const { detectCoverageGaps } = await import('../dist/lane-health.js');

      const lanes = [
        { name: LANE_FRAMEWORK_CORE, code_paths: [PATH_CORE] },
        { name: LANE_FRAMEWORK_CLI, code_paths: [PATH_CLI] },
      ];

      const result = detectCoverageGaps(lanes, {
        projectRoot: TEST_PROJECT_ROOT,
        excludePatterns: ['node_modules/**'],
      });

      expect(result.hasGaps).toBe(false);
      expect(result.uncoveredFiles).toEqual([]);
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
      const fs = await import('fs');
      const fsMock = fs as {
        readFileSync: ReturnType<typeof vi.fn>;
        existsSync: ReturnType<typeof vi.fn>;
      };

      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue(`
lanes:
  definitions:
    - name: '${LANE_FRAMEWORK_CORE}'
      wip_limit: 1
      code_paths:
        - '${PATH_CORE}'
    - name: '${LANE_FRAMEWORK_CLI}'
      wip_limit: 1
      code_paths:
        - '${PATH_CLI}'
`);

      const { loadLaneDefinitions } = await import('../dist/lane-health.js');

      const lanes = loadLaneDefinitions(TEST_PROJECT_ROOT);

      expect(lanes.length).toBe(2);
      expect(lanes[0].name).toBe(LANE_FRAMEWORK_CORE);
      expect(lanes[0].code_paths).toEqual([PATH_CORE]);
      expect(lanes[1].name).toBe(LANE_FRAMEWORK_CLI);
    });

    it('returns empty array when no config file exists', async () => {
      const fs = await import('fs');
      const fsMock = fs as { existsSync: ReturnType<typeof vi.fn> };

      fsMock.existsSync.mockReturnValue(false);

      const { loadLaneDefinitions } = await import('../dist/lane-health.js');

      const lanes = loadLaneDefinitions(TEST_PROJECT_ROOT);

      expect(lanes).toEqual([]);
    });
  });
});
