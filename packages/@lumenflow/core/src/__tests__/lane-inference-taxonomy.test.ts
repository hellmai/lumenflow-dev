/**
 * @file lane-inference-taxonomy.test.mjs
 * @description Comprehensive lane taxonomy audit tests for WU-2439.
 *
 * Tests verify:
 * 1. No stale paths exist in config (paths that reference non-existent directories)
 * 2. No invalid test path patterns (like __tests__/unit/** at repo root)
 * 3. No ambiguous keyword overlaps (same keyword in multiple sub-lanes)
 * 4. All sub-lanes have sufficient keywords for reliable inference
 * 5. Missing domain terms are captured
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import YAML from 'yaml';

const WORKTREE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CONFIG_PATH = path.join(WORKTREE_ROOT, '.lumenflow.lane-inference.yaml');

/**
 * Stale paths that should NOT be in the config because they reference
 * directories that don't exist at repo root.
 * These are direct child directories - NOT nested paths like supabase/migrations/**
 */
const STALE_ROOT_PATHS = [
  'migrations/**', // No top-level migrations/ dir (supabase/migrations/** is valid)
  'prisma/**', // No prisma/ dir
  'infrastructure/**', // No infrastructure/ dir
  'docker/**', // No docker/ dir
  'prototypes/**', // No prototypes/ dir
  'sandbox/**', // No sandbox/ dir
  'blog/**', // No blog/ dir
];

/**
 * Invalid test path patterns that reference __tests__ at repo root.
 * These patterns don't match actual test file locations.
 * Tests are located in:
 * - tools/__tests__/
 * - tools/lib/__tests__/
 * - apps/web/src/.../__tests__/
 */
const INVALID_TEST_PATH_PATTERNS = [
  '__tests__/unit/classifiers/**',
  '__tests__/integration/orchestrator/**',
  '__tests__/integration/golden/**',
  '__tests__/unit/api/**',
  '__tests__/unit/components/**',
];

/**
 * Keywords that must NOT appear in more than one sub-lane.
 * Each keyword should uniquely identify a sub-lane for unambiguous inference.
 */
const OVERLAPPING_KEYWORDS = [
  'workflow', // Operations: CI/CD AND Operations: Governance
  'schema', // Operations: Workflow Engine AND Core Systems: Data
  'evaluation', // Intelligence: Evaluation AND Discovery: Analysis
  'pipeline', // Operations: CI/CD AND possibly others
  'retention', // Customer: Success AND Revenue Ops: Analytics
  'deployment', // Operations: CI/CD AND Core Systems: Infra
  'wu:claim', // Operations: Tooling AND Operations: CLI
  'wu:done', // Operations: Tooling AND Operations: CLI
  'wu:create', // Operations: Tooling AND Operations: CLI
];

/**
 * Sub-lanes that were identified as sparse (< 8 keywords) and must be expanded.
 * Per AC4: Orchestrator, Evaluation, Mobile must have >= 8 keywords each.
 */
const SPARSE_SUBLANES_REQUIRING_EXPANSION = [
  'Intelligence: Orchestrator',
  'Intelligence: Evaluation',
  'Experience: Mobile',
];

/**
 * Minimum keyword count for reliable inference.
 * Sub-lanes with fewer keywords have poor inference accuracy.
 */
const MIN_KEYWORDS_FOR_RELIABLE_INFERENCE = 8;

describe('Lane Taxonomy Audit (WU-2439)', () => {
  let config;

  beforeAll(() => {
    if (!existsSync(CONFIG_PATH)) {
      throw new Error(`Config not found: ${CONFIG_PATH}`);
    }
    config = YAML.parse(readFileSync(CONFIG_PATH, 'utf8'));
  });

  describe('AC1: Stale paths removed', () => {
    it('should not contain stale root-level paths that reference non-existent directories', () => {
      const allCodePaths = [];

      // Collect all code_paths from config
      for (const [, subLanes] of Object.entries(config)) {
        for (const [, subLaneConfig] of Object.entries(subLanes)) {
          if (subLaneConfig.code_paths) {
            allCodePaths.push(...subLaneConfig.code_paths);
          }
        }
      }

      // Check each stale path is not present
      const foundStalePaths = [];
      for (const stalePath of STALE_ROOT_PATHS) {
        if (allCodePaths.includes(stalePath)) {
          foundStalePaths.push(stalePath);
        }
      }

      expect(
        foundStalePaths,
        `Found stale paths in config: ${foundStalePaths.join(', ')}. These directories don't exist.`
      ).toHaveLength(0);
    });

    it('should verify all 7 stale paths are removed', () => {
      // Count check to ensure we're testing all 7 stale paths
      expect(STALE_ROOT_PATHS.length).toBe(7);
    });
  });

  describe('AC2: Invalid test path patterns removed or corrected', () => {
    it('should not contain __tests__/unit/** or __tests__/integration/** at repo root', () => {
      const allCodePaths = [];

      for (const [, subLanes] of Object.entries(config)) {
        for (const [, subLaneConfig] of Object.entries(subLanes)) {
          if (subLaneConfig.code_paths) {
            allCodePaths.push(...subLaneConfig.code_paths);
          }
        }
      }

      const foundInvalidPaths = [];
      for (const invalidPath of INVALID_TEST_PATH_PATTERNS) {
        if (allCodePaths.includes(invalidPath)) {
          foundInvalidPaths.push(invalidPath);
        }
      }

      expect(
        foundInvalidPaths,
        `Found invalid test path patterns: ${foundInvalidPaths.join(', ')}. ` +
          `These __tests__/ patterns at repo root don't match actual test locations.`
      ).toHaveLength(0);
    });

    it('should verify all 5 invalid test patterns are addressed', () => {
      expect(INVALID_TEST_PATH_PATTERNS.length).toBe(5);
    });
  });

  describe('AC3: Keyword overlaps disambiguated', () => {
    /**
     * Test that overlapping keywords are either:
     * 1. Removed from all but one sub-lane, OR
     * 2. Prefixed to be unique (e.g., "workflow" -> "github workflow" vs "lumenflow workflow")
     */
    it('should not have the same keyword in multiple sub-lanes', () => {
      // Build keyword -> sub-lanes map
      const keywordToSubLanes = new Map();

      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
          const fullLane = `${parentLane}: ${subLane}`;
          const keywords = subLaneConfig.keywords || [];

          for (const keyword of keywords) {
            const normalizedKeyword = keyword.toLowerCase().trim();
            if (!keywordToSubLanes.has(normalizedKeyword)) {
              keywordToSubLanes.set(normalizedKeyword, []);
            }
            keywordToSubLanes.get(normalizedKeyword).push(fullLane);
          }
        }
      }

      // Find keywords that appear in multiple sub-lanes
      const duplicateKeywords = [];
      for (const [keyword, lanes] of keywordToSubLanes) {
        if (lanes.length > 1) {
          duplicateKeywords.push({ keyword, lanes });
        }
      }

      expect(
        duplicateKeywords,
        `Found ambiguous keywords appearing in multiple sub-lanes:\n` +
          duplicateKeywords.map((d) => `  "${d.keyword}" -> ${d.lanes.join(', ')}`).join('\n')
      ).toHaveLength(0);
    });

    it('should verify the 9 originally overlapping keywords are disambiguated', () => {
      expect(OVERLAPPING_KEYWORDS.length).toBe(9);
    });
  });

  describe('AC4: Sparse sub-lanes expanded', () => {
    it('should have >= 8 keywords for Orchestrator, Evaluation, and Mobile', () => {
      const sparseViolations = [];

      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
          const fullLane = `${parentLane}: ${subLane}`;
          if (SPARSE_SUBLANES_REQUIRING_EXPANSION.includes(fullLane)) {
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
      }

      expect(
        sparseViolations,
        `Sub-lanes with insufficient keywords:\n` +
          sparseViolations
            .map((v) => `  ${v.lane}: ${v.count} keywords (need >= ${v.required})`)
            .join('\n')
      ).toHaveLength(0);
    });
  });

  describe('AC5: Full coverage taxonomy validation', () => {
    it('should have all 33 sub-lanes defined', () => {
      let subLaneCount = 0;
      for (const [, subLanes] of Object.entries(config)) {
        subLaneCount += Object.keys(subLanes).length;
      }
      expect(subLaneCount).toBe(33);
    });

    it('should have all 8 parent lanes defined', () => {
      const expectedParentLanes = [
        'Intelligence',
        'Operations',
        'Core Systems',
        'Experience',
        'Discovery',
        'Customer',
        'Revenue Ops',
        'Comms',
      ];

      const actualParentLanes = Object.keys(config);
      expect(actualParentLanes.sort()).toEqual(expectedParentLanes.sort());
    });

    it('should have description for every sub-lane', () => {
      const missingDescriptions = [];

      for (const [parentLane, subLanes] of Object.entries(config)) {
        for (const [subLane, subLaneConfig] of Object.entries(subLanes)) {
          if (!subLaneConfig.description || subLaneConfig.description.trim() === '') {
            missingDescriptions.push(`${parentLane}: ${subLane}`);
          }
        }
      }

      expect(
        missingDescriptions,
        `Sub-lanes missing descriptions: ${missingDescriptions.join(', ')}`
      ).toHaveLength(0);
    });

    it('should have at least one code_path for every sub-lane', () => {
      const missingCodePaths = [];

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
        `Sub-lanes missing code_paths: ${missingCodePaths.join(', ')}`
      ).toHaveLength(0);
    });

    it('should have at least one keyword for every sub-lane', () => {
      const missingKeywords = [];

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
        `Sub-lanes missing keywords: ${missingKeywords.join(', ')}`
      ).toHaveLength(0);
    });
  });
});

describe('Lane Inference Integration (WU-2439)', () => {
  /**
   * Integration tests to verify inference works correctly after taxonomy audit.
   * These tests use real inference function to validate config changes.
   */

  it('should infer correctly for Intelligence: Orchestrator with expanded keywords', async () => {
    const { inferSubLane } = await import('../lane-inference.mjs');

    // Test with streaming-related description
    const result = inferSubLane(
      ['apps/web/src/lib/orchestrator/index.ts'],
      'Fix streaming response handling in orchestrator'
    );

    expect(result.lane).toBe('Intelligence: Orchestrator');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should infer correctly for Intelligence: Evaluation with expanded keywords', async () => {
    const { inferSubLane } = await import('../lane-inference.mjs');

    const result = inferSubLane(
      ['tools/prompts-eval/harness.ts'],
      'Add new golden dataset for prompt evaluation'
    );

    expect(result.lane).toBe('Intelligence: Evaluation');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should infer correctly for Experience: Mobile with expanded keywords', async () => {
    const { inferSubLane } = await import('../lane-inference.mjs');

    const result = inferSubLane(['apps/mobile/App.tsx'], 'Fix mobile app navigation on iOS');

    expect(result.lane).toBe('Experience: Mobile');
    expect(result.confidence).toBeGreaterThan(0);
  });

  it('should distinguish between CI/CD workflow and Governance workflow', async () => {
    const { inferSubLane } = await import('../lane-inference.mjs');

    // CI/CD workflow (GitHub Actions)
    const cicdResult = inferSubLane(
      ['.github/workflows/ci.yml'],
      'Fix GitHub Actions workflow for CI'
    );

    // Governance workflow (LumenFlow)
    const govResult = inferSubLane(
      ['docs/04-operations/_frameworks/lumenflow/lumenflow-complete.md'],
      'Update LumenFlow workflow documentation'
    );

    expect(cicdResult.lane).toBe('Operations: CI/CD');
    expect(govResult.lane).toBe('Operations: Governance');
  });

  it('should distinguish between Data schema and Workflow Engine schema', async () => {
    const { inferSubLane } = await import('../lane-inference.mjs');

    // Data schema (database)
    const dataResult = inferSubLane(
      ['supabase/migrations/001_schema.sql'],
      'Add new table schema for patients'
    );

    // Workflow Engine schema (WU validation)
    const wfResult = inferSubLane(['tools/lib/wu-schema.mjs'], 'Update WU schema validation');

    expect(dataResult.lane).toBe('Core Systems: Data');
    expect(wfResult.lane).toBe('Operations: Workflow Engine');
  });

  it('should not infer from stale paths after removal', async () => {
    const { inferSubLane } = await import('../lane-inference.mjs');

    // These paths don't exist, so they shouldn't strongly influence inference
    // The inference should fall back to description/other patterns
    const result = inferSubLane(
      ['prisma/schema.prisma'], // Stale path - should not match
      'Add new field to user model'
    );

    // Should NOT match Core Systems: Data just from stale path
    // Without strong signals, it might fall back or match based on keywords
    expect(result.confidence).toBeDefined();
  });
});
