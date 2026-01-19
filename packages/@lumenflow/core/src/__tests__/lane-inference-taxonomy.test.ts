/**
 * @file lane-inference-taxonomy.test.ts
 * @description Lane taxonomy validation tests for LumenFlow OS.
 *
 * Tests verify:
 * 1. No stale paths exist in config (paths that reference non-existent directories)
 * 2. No invalid test path patterns
 * 3. No ambiguous keyword overlaps (same keyword in multiple sub-lanes)
 * 4. All sub-lanes have sufficient keywords for reliable inference
 * 5. Full taxonomy coverage validation
 *
 * LumenFlow OS Taxonomy: 10 sub-lanes across 3 parent lanes
 * - Framework: Core, CLI, Memory, Agent, Metrics, Initiatives, Shims
 * - Operations: Infrastructure, CI/CD
 * - Content: Documentation
 *
 * Created: WU-1019
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

// Go up 5 levels: __tests__ -> src -> core -> @lumenflow -> packages -> repo root
const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const CONFIG_PATH = path.join(WORKTREE_ROOT, '.lumenflow.lane-inference.yaml');

// Skip all tests if config file doesn't exist (running in standalone package without project context)
const hasConfig = existsSync(CONFIG_PATH);

/**
 * Stale paths that should NOT be in the config because they reference
 * directories that don't exist at repo root.
 */
const STALE_ROOT_PATHS = [
  'migrations/**', // No top-level migrations/ dir
  'prisma/**', // No prisma/ dir
  'infrastructure/**', // No infrastructure/ dir
  'docker/**', // No docker/ dir
  'prototypes/**', // No prototypes/ dir
  'sandbox/**', // No sandbox/ dir
  'blog/**', // No blog/ dir
];

/**
 * Invalid test path patterns that reference __tests__ at repo root.
 */
const INVALID_TEST_PATH_PATTERNS = ['__tests__/unit/**', '__tests__/integration/**'];

/**
 * Minimum keyword count for reliable inference.
 * Sub-lanes with fewer keywords have poor inference accuracy.
 */
const MIN_KEYWORDS_FOR_RELIABLE_INFERENCE = 8;

/**
 * LumenFlow OS taxonomy definition for validation
 */
const LUMENFLOW_TAXONOMY = {
  parentLanes: ['Framework', 'Operations', 'Content'],
  subLaneCount: 10,
  expectedSubLanes: [
    'Framework: Core',
    'Framework: CLI',
    'Framework: Memory',
    'Framework: Agent',
    'Framework: Metrics',
    'Framework: Initiatives',
    'Framework: Shims',
    'Operations: Infrastructure',
    'Operations: CI/CD',
    'Content: Documentation',
  ],
};

describe.skipIf(!hasConfig)('Lane Taxonomy Validation (WU-1019)', () => {
  let config: Record<
    string,
    Record<string, { description?: string; code_paths?: string[]; keywords?: string[] }>
  >;

  beforeAll(() => {
    if (!existsSync(CONFIG_PATH)) {
      throw new Error(`Config not found: ${CONFIG_PATH}`);
    }
    config = YAML.parse(readFileSync(CONFIG_PATH, 'utf8'));
  });

  describe('Stale paths validation', () => {
    it('should not contain stale root-level paths that reference non-existent directories', () => {
      const allCodePaths: string[] = [];

      // Collect all code_paths from config
      for (const [, subLanes] of Object.entries(config)) {
        for (const [, subLaneConfig] of Object.entries(subLanes)) {
          if (subLaneConfig.code_paths) {
            allCodePaths.push(...subLaneConfig.code_paths);
          }
        }
      }

      // Check each stale path is not present
      const foundStalePaths: string[] = [];
      for (const stalePath of STALE_ROOT_PATHS) {
        if (allCodePaths.includes(stalePath)) {
          foundStalePaths.push(stalePath);
        }
      }

      expect(
        foundStalePaths,
        `Found stale paths in config: ${foundStalePaths.join(', ')}. These directories don't exist.`,
      ).toHaveLength(0);
    });
  });

  describe('Invalid test path patterns validation', () => {
    it('should not contain __tests__/unit/** or __tests__/integration/** at repo root', () => {
      const allCodePaths: string[] = [];

      for (const [, subLanes] of Object.entries(config)) {
        for (const [, subLaneConfig] of Object.entries(subLanes)) {
          if (subLaneConfig.code_paths) {
            allCodePaths.push(...subLaneConfig.code_paths);
          }
        }
      }

      const foundInvalidPaths: string[] = [];
      for (const invalidPath of INVALID_TEST_PATH_PATTERNS) {
        if (allCodePaths.includes(invalidPath)) {
          foundInvalidPaths.push(invalidPath);
        }
      }

      expect(
        foundInvalidPaths,
        `Found invalid test path patterns: ${foundInvalidPaths.join(', ')}`,
      ).toHaveLength(0);
    });
  });

  describe('Keyword uniqueness validation', () => {
    it('should not have the same keyword in multiple sub-lanes', () => {
      // Build keyword -> sub-lanes map
      const keywordToSubLanes = new Map<string, string[]>();

      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
          const fullLane = `${parentLane}: ${subLane}`;
          const keywords = subLaneConfig.keywords || [];

          for (const keyword of keywords) {
            const normalizedKeyword = keyword.toLowerCase().trim();
            if (!keywordToSubLanes.has(normalizedKeyword)) {
              keywordToSubLanes.set(normalizedKeyword, []);
            }
            keywordToSubLanes.get(normalizedKeyword)!.push(fullLane);
          }
        }
      }

      // Find keywords that appear in multiple sub-lanes
      const duplicateKeywords: Array<{ keyword: string; lanes: string[] }> = [];
      for (const [keyword, lanes] of keywordToSubLanes) {
        if (lanes.length > 1) {
          duplicateKeywords.push({ keyword, lanes });
        }
      }

      expect(
        duplicateKeywords,
        `Found ambiguous keywords appearing in multiple sub-lanes:\n` +
          duplicateKeywords.map((d) => `  "${d.keyword}" -> ${d.lanes.join(', ')}`).join('\n'),
      ).toHaveLength(0);
    });
  });

  describe('Keyword coverage validation', () => {
    it('should have >= 8 keywords for all sub-lanes', () => {
      const sparseViolations: Array<{ lane: string; count: number; required: number }> = [];

      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
          const fullLane = `${parentLane}: ${subLane}`;
          const keywordCount = (subLaneConfig.keywords || []).length;
          if (keywordCount < MIN_KEYWORDS_FOR_RELIABLE_INFERENCE) {
            sparseViolations.push({
              lane: fullLane,
              count: keywordCount,
              required: MIN_KEYWORDS_FOR_RELIABLE_INFERENCE,
            });
          }
        }
      }

      expect(
        sparseViolations,
        `Sub-lanes with insufficient keywords:\n` +
          sparseViolations
            .map((v) => `  ${v.lane}: ${v.count} keywords (need >= ${v.required})`)
            .join('\n'),
      ).toHaveLength(0);
    });
  });

  describe('LumenFlow OS taxonomy validation', () => {
    it(`should have ${LUMENFLOW_TAXONOMY.subLaneCount} sub-lanes defined`, () => {
      let subLaneCount = 0;
      for (const [, subLanes] of Object.entries(config)) {
        subLaneCount += Object.keys(subLanes).length;
      }
      expect(subLaneCount).toBe(LUMENFLOW_TAXONOMY.subLaneCount);
    });

    it(`should have all ${LUMENFLOW_TAXONOMY.parentLanes.length} parent lanes defined`, () => {
      const actualParentLanes = Object.keys(config);
      expect(actualParentLanes.sort()).toEqual(LUMENFLOW_TAXONOMY.parentLanes.sort());
    });

    it('should have all expected sub-lanes', () => {
      const actualSubLanes: string[] = [];
      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const subLane of Object.keys(subLanes)) {
          actualSubLanes.push(`${parentLane}: ${subLane}`);
        }
      }
      expect(actualSubLanes.sort()).toEqual(LUMENFLOW_TAXONOMY.expectedSubLanes.sort());
    });

    it('should have description for every sub-lane', () => {
      const missingDescriptions: string[] = [];

      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
          if (!subLaneConfig.description || subLaneConfig.description.trim() === '') {
            missingDescriptions.push(`${parentLane}: ${subLane}`);
          }
        }
      }

      expect(
        missingDescriptions,
        `Sub-lanes missing descriptions: ${missingDescriptions.join(', ')}`,
      ).toHaveLength(0);
    });

    it('should have at least one code_path for every sub-lane', () => {
      const missingCodePaths: string[] = [];

      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
          const codePaths = subLaneConfig.code_paths || [];
          if (codePaths.length === 0) {
            missingCodePaths.push(`${parentLane}: ${subLane}`);
          }
        }
      }

      expect(
        missingCodePaths,
        `Sub-lanes missing code_paths: ${missingCodePaths.join(', ')}`,
      ).toHaveLength(0);
    });

    it('should have at least one keyword for every sub-lane', () => {
      const missingKeywords: string[] = [];

      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
          const keywords = subLaneConfig.keywords || [];
          if (keywords.length === 0) {
            missingKeywords.push(`${parentLane}: ${subLane}`);
          }
        }
      }

      expect(
        missingKeywords,
        `Sub-lanes missing keywords: ${missingKeywords.join(', ')}`,
      ).toHaveLength(0);
    });
  });
});

describe.skipIf(!hasConfig)('Lane Inference Integration (WU-1019)', () => {
  /**
   * Integration tests to verify inference works correctly with LumenFlow OS taxonomy.
   */

  it('should infer correctly for Framework: CLI', async () => {
    const { inferSubLane } = await import('../lane-inference.js');

    const result = inferSubLane(
      ['packages/@lumenflow/cli/src/wu-claim.ts'],
      'Add new wu:claim command option',
    );

    expect(result.lane).toBe('Framework: CLI');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should infer correctly for Framework: Core', async () => {
    const { inferSubLane } = await import('../lane-inference.js');

    const result = inferSubLane(
      ['packages/@lumenflow/core/src/git-adapter.ts'],
      'Fix git adapter for worktree operations',
    );

    expect(result.lane).toBe('Framework: Core');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should infer correctly for Framework: Metrics', async () => {
    const { inferSubLane } = await import('../lane-inference.js');

    const result = inferSubLane(
      ['packages/@lumenflow/metrics/src/dora.ts'],
      'Add DORA deployment frequency calculation',
    );

    expect(result.lane).toBe('Framework: Metrics');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should infer correctly for Operations: CI/CD', async () => {
    const { inferSubLane } = await import('../lane-inference.js');

    const result = inferSubLane(['.github/workflows/ci.yml'], 'Fix GitHub Actions workflow for CI');

    expect(result.lane).toBe('Operations: CI/CD');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should infer correctly for Content: Documentation', async () => {
    const { inferSubLane } = await import('../lane-inference.js');

    const result = inferSubLane(['docs/lumenflow/playbook.md'], 'Update playbook documentation');

    expect(result.lane).toBe('Content: Documentation');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should distinguish between Infrastructure and CI/CD', async () => {
    const { inferSubLane } = await import('../lane-inference.js');

    // Infrastructure (apps, turbo)
    const infraResult = inferSubLane(
      ['apps/web/package.json'],
      'Update app deployment configuration',
    );

    // CI/CD (GitHub workflows)
    const cicdResult = inferSubLane(
      ['.github/workflows/deploy.yml'],
      'Fix deployment workflow automation',
    );

    expect(infraResult.lane).toBe('Operations: Infrastructure');
    expect(cicdResult.lane).toBe('Operations: CI/CD');
  });
});
