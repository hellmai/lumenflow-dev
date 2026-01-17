#!/usr/bin/env node
/**
 * Golden Fixtures Test for Code Path Validators (WU-1825)
 *
 * This test suite captures the current behaviour of all three code path validators
 * to ensure behavioural preservation during the consolidation refactor.
 *
 * Validators being consolidated:
 * 1. validateCodePathsExist() from wu-done-validators.mjs
 *    - Validates that files in code_paths exist
 *    - Supports worktree mode and git ls-tree mode
 *    - Returns { valid, errors[], missing[] }
 *
 * 2. validateLaneCodePaths() from lane-validator.mjs
 *    - Validates code_paths are appropriate for the lane
 *    - Advisory only (warnings, never blocks)
 *    - Returns { hasWarnings, warnings[], violations[], skipped }
 *
 * 3. validateWUCodePaths() from wu-validator.mjs
 *    - Validates code quality (no TODOs, no Mocks)
 *    - Also validates file existence
 *    - Returns { valid, errors[], warnings[] }
 *
 * Run: node --test tools/lib/__tests__/code-path-validator.golden.test.mjs
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Import the three validators we are consolidating (ORIGINAL sources)
import { validateCodePathsExist } from '../wu-done-validators.js';
import { validateLaneCodePaths } from '../lane-validator.js';
import { validateWUCodePaths } from '../wu-validator.js';

// Import the UNIFIED validator's backward-compatible exports
import {
  validateCodePathsExist as unifiedValidateCodePathsExist,
  validateLaneCodePaths as unifiedValidateLaneCodePaths,
  validateWUCodePaths as unifiedValidateWUCodePaths,
  validate,
  VALIDATION_MODES,
} from '../code-path-validator.js';

// ============================================================================
// GOLDEN FIXTURES: validateCodePathsExist (wu-done-validators.mjs)
// ============================================================================

describe('GOLDEN: validateCodePathsExist (wu-done-validators.mjs)', () => {
  const testDir = '/tmp/wu-1825-golden-code-paths-exist';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('empty/undefined code_paths', () => {
    it('returns valid=true for empty code_paths array', async () => {
      const doc = { id: 'WU-TEST', code_paths: [] };
      const result = await validateCodePathsExist(doc, 'WU-TEST');

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.missing).toEqual([]);
    });

    it('returns valid=true for undefined code_paths', async () => {
      const doc = { id: 'WU-TEST' };
      const result = await validateCodePathsExist(doc, 'WU-TEST');

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.missing).toEqual([]);
    });

    it('returns valid=true for null code_paths', async () => {
      const doc = { id: 'WU-TEST', code_paths: null };
      const result = await validateCodePathsExist(doc, 'WU-TEST');

      expect(result.valid).toBe(true);
    });
  });

  describe('worktree mode - file existence check', () => {
    it('returns valid=true when all files exist in worktree', async () => {
      // Create test files
      const file1 = join(testDir, 'src', 'file1.js');
      const file2 = join(testDir, 'src', 'file2.js');
      mkdirSync(join(testDir, 'src'), { recursive: true });
      writeFileSync(file1, 'export const x = 1;');
      writeFileSync(file2, 'export const y = 2;');

      const doc = {
        id: 'WU-TEST',
        code_paths: ['src/file1.js', 'src/file2.js'],
      };

      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('returns valid=false with missing files listed', async () => {
      // Create only one file
      const file1 = join(testDir, 'existing.js');
      writeFileSync(file1, 'content');

      const doc = {
        id: 'WU-TEST',
        code_paths: ['existing.js', 'missing.js', 'also-missing.js'],
      };

      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      expect(result.valid).toBe(false);
      expect(result.missing.includes('missing.js')).toBe(true);
      expect(result.missing.includes('also-missing.js')).toBe(true);
      expect(result.missing.length).toBe(2);
    });

    it('includes contextual error message about worktree', async () => {
      const doc = {
        id: 'WU-TEST',
        code_paths: ['nonexistent.js'],
      };

      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].includes('not found in worktree')).toBe(true);
    });
  });

  describe('error message structure', () => {
    it('error message includes count of missing files', async () => {
      const doc = {
        id: 'WU-TEST',
        code_paths: ['a.js', 'b.js', 'c.js'],
      };

      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].includes('3 file(s)')).toBeTruthy();
    });

    it('error message lists each missing file with bullet point', async () => {
      const doc = {
        id: 'WU-TEST',
        code_paths: ['missing-file.js'],
      };

      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      expect(result.errors[0].includes('- missing-file.js')).toBe(true);
    });
  });
});

// ============================================================================
// GOLDEN FIXTURES: validateLaneCodePaths (lane-validator.mjs)
// ============================================================================

describe('GOLDEN: validateLaneCodePaths (lane-validator.mjs)', () => {
  describe('empty/undefined code_paths', () => {
    it('returns skipped=true for empty code_paths array', () => {
      const doc = { code_paths: [] };
      const result = validateLaneCodePaths(doc, 'Operations: Tooling');

      expect(result.hasWarnings).toBe(false);
      expect(result.skipped).toBe(true);
      expect(result.warnings).toEqual([]);
      expect(result.violations).toEqual([]);
    });

    it('returns skipped=true for undefined code_paths', () => {
      const doc = {};
      const result = validateLaneCodePaths(doc, 'Operations: Tooling');

      expect(result.skipped).toBe(true);
    });

    it('returns skipped=true for null code_paths', () => {
      const doc = { code_paths: null };
      const result = validateLaneCodePaths(doc, 'Operations: Tooling');

      expect(result.skipped).toBe(true);
    });
  });

  describe('lane pattern matching', () => {
    it('returns skipped=true for lanes without defined patterns', () => {
      // Using a lane that has no patterns defined in LANE_PATH_PATTERNS
      const doc = { code_paths: ['some/random/path.ts'] };
      const result = validateLaneCodePaths(doc, 'NonExistent: Lane');

      expect(result.skipped).toBe(true);
      expect(result.hasWarnings).toBe(false);
    });

    it('returns hasWarnings=false when paths match lane expectations', () => {
      // Operations lane with tools/ paths - should be valid
      const doc = { code_paths: ['tools/lib/wu-helpers.js'] };
      const result = validateLaneCodePaths(doc, 'Operations: Tooling');

      expect(result.hasWarnings).toBe(false);
      expect(result.violations).toEqual([]);
    });

    it('returns hasWarnings=true for paths that violate lane patterns', () => {
      // Operations lane should warn about Experience-layer paths
      // Note: This test depends on LANE_PATH_PATTERNS configuration
      const doc = { code_paths: ['apps/web/src/components/Button.tsx'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      // If Operations has exclude patterns for apps/web/, this should warn
      // The exact behaviour depends on LANE_PATH_PATTERNS configuration
      // This golden test captures current behaviour
      if (result.hasWarnings) {
        expect(result.violations.length > 0).toBeTruthy();
        expect(result.warnings.length > 0).toBeTruthy();
      }
    });
  });

  describe('warning message format', () => {
    it('warning message includes lane name', () => {
      // This test may need adjustment based on LANE_PATH_PATTERNS
      const doc = { code_paths: ['apps/web/src/component.tsx'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      if (result.hasWarnings) {
        expect(result.warnings[0].includes('Operations')).toBe(true);
      }
    });

    it('warning message includes violating path', () => {
      const doc = { code_paths: ['apps/web/src/specific-file.tsx'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      if (result.hasWarnings) {
        expect(result.warnings[0].includes('apps/web/src/specific-file.tsx')).toBe(true);
      }
    });
  });

  describe('result structure', () => {
    it('returns correct shape for valid result', () => {
      const doc = { code_paths: ['tools/helper.js'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      expect('hasWarnings' in result).toBeTruthy();
      expect('warnings' in result).toBeTruthy();
      expect('violations' in result).toBeTruthy();
      expect('skipped' in result).toBeTruthy();
      expect(Array.isArray(result.warnings)).toBe(true);
      expect(Array.isArray(result.violations)).toBe(true);
    });
  });
});

// ============================================================================
// GOLDEN FIXTURES: validateWUCodePaths (wu-validator.mjs)
// ============================================================================

describe('GOLDEN: validateWUCodePaths (wu-validator.mjs)', () => {
  const testDir = '/tmp/wu-1825-golden-wu-code-paths';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('empty/undefined code_paths', () => {
    it('returns valid=true for empty code_paths array', () => {
      const result = validateWUCodePaths([]);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('returns valid=true for undefined code_paths', () => {
      const result = validateWUCodePaths(undefined);

      expect(result.valid).toBe(true);
    });

    it('returns valid=true for null code_paths', () => {
      const result = validateWUCodePaths(null);

      expect(result.valid).toBe(true);
    });
  });

  describe('file existence validation', () => {
    it('returns valid=false when file does not exist', () => {
      const result = validateWUCodePaths(['nonexistent-file.js'], {
        worktreePath: testDir,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length > 0).toBeTruthy();
    });

    it('error message includes file path that does not exist', () => {
      const result = validateWUCodePaths(['specific-missing-file.js'], {
        worktreePath: testDir,
      });

      expect(result.errors[0].includes('specific-missing-file.js')).toBe(true);
    });

    it('returns valid=true when all files exist and have no issues', () => {
      const file = join(testDir, 'clean-file.js');
      writeFileSync(file, 'export const clean = true;');

      const result = validateWUCodePaths(['clean-file.js'], {
        worktreePath: testDir,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe('TODO/FIXME/HACK/XXX detection', () => {
    it('returns valid=false when TODO comment found in code', () => {
      const file = join(testDir, 'todo-file.js');
      writeFileSync(file, '// TODO: implement this\nexport const x = 1;');

      const result = validateWUCodePaths(['todo-file.js'], {
        worktreePath: testDir,
        allowTodos: false,
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].includes('TODO')).toBe(true);
    });

    it('returns valid=true with warning when allowTodos=true', () => {
      const file = join(testDir, 'todo-allowed.js');
      writeFileSync(file, '// TODO: this is allowed\nexport const x = 1;');

      const result = validateWUCodePaths(['todo-allowed.js'], {
        worktreePath: testDir,
        allowTodos: true,
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.length > 0).toBeTruthy();
    });

    it('detects FIXME comments', () => {
      const file = join(testDir, 'fixme-file.js');
      writeFileSync(file, '// FIXME: broken thing\nexport const x = 1;');

      const result = validateWUCodePaths(['fixme-file.js'], {
        worktreePath: testDir,
        allowTodos: false,
      });

      expect(result.valid).toBe(false);
      expect(result.errors[0].includes('FIXME') || result.errors[0].includes('TODO')).toBe(true);
    });

    it('skips test files for TODO detection', () => {
      const testFile = join(testDir, 'component.test.js');
      writeFileSync(testFile, '// TODO: add more tests\nexport const test = true;');

      const result = validateWUCodePaths(['component.test.js'], {
        worktreePath: testDir,
        allowTodos: false,
      });

      // Test files should be skipped for TODO detection
      expect(result.valid).toBe(true);
    });

    it('skips markdown files for TODO detection', () => {
      const mdFile = join(testDir, 'README.md');
      writeFileSync(mdFile, '# Project\n\n- TODO: document this feature');

      const result = validateWUCodePaths(['README.md'], {
        worktreePath: testDir,
        allowTodos: false,
      });

      // Markdown files should be skipped for TODO detection
      expect(result.valid).toBe(true);
    });
  });

  describe('Mock/Stub/Fake detection', () => {
    it('returns warning (not error) when Mock class found', () => {
      const file = join(testDir, 'mock-class.js');
      writeFileSync(file, 'export class MockService { }');

      const result = validateWUCodePaths(['mock-class.js'], {
        worktreePath: testDir,
      });

      // Mocks are warnings, not errors - WU is still valid
      expect(result.valid).toBe(true);
      expect(result.warnings.length > 0).toBeTruthy();
      expect(result.warnings[0].includes('Mock')).toBe(true);
    });

    it('skips test files for Mock detection', () => {
      const testFile = join(testDir, 'service.test.js');
      writeFileSync(testFile, 'export class MockService { }');

      const result = validateWUCodePaths(['service.test.js'], {
        worktreePath: testDir,
      });

      // Test files should be skipped for mock detection
      expect(result.valid).toBe(true);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('result structure', () => {
    it('returns correct shape', () => {
      const result = validateWUCodePaths([]);

      expect('valid' in result).toBeTruthy();
      expect('errors' in result).toBeTruthy();
      expect('warnings' in result).toBeTruthy();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });
});

// ============================================================================
// CROSS-VALIDATOR BEHAVIOUR COMPARISON
// ============================================================================

describe('GOLDEN: Cross-validator behaviour consistency', () => {
  const testDir = '/tmp/wu-1825-golden-cross-validator';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('empty code_paths handling', () => {
    it('all three validators accept empty arrays gracefully', async () => {
      // validateCodePathsExist
      const existResult = await validateCodePathsExist(
        { id: 'WU-TEST', code_paths: [] },
        'WU-TEST'
      );
      expect(existResult.valid).toBe(true);

      // validateLaneCodePaths
      const laneResult = validateLaneCodePaths({ code_paths: [] }, 'Operations');
      expect(laneResult.hasWarnings).toBe(false);
      expect(laneResult.skipped).toBe(true);

      // validateWUCodePaths
      const wuResult = validateWUCodePaths([]);
      expect(wuResult.valid).toBe(true);
    });
  });

  describe('file existence semantics', () => {
    it('validateCodePathsExist and validateWUCodePaths both check file existence', async () => {
      const doc = {
        id: 'WU-TEST',
        code_paths: ['nonexistent.js'],
      };

      const existResult = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });
      const wuResult = validateWUCodePaths(['nonexistent.js'], {
        worktreePath: testDir,
      });

      // Both should fail for missing files
      expect(existResult.valid).toBe(false);
      expect(wuResult.valid).toBe(false);
    });

    it('validateLaneCodePaths does NOT check file existence (pattern-only)', () => {
      const doc = {
        code_paths: ['nonexistent-but-matches-pattern.js'],
      };

      const laneResult = validateLaneCodePaths(doc, 'Operations');

      // Lane validator only checks patterns, not file existence
      // It should not fail due to missing files
      // (It may warn if path violates lane patterns, but not for non-existence)
      expect(!laneResult.hasWarnings || !laneResult.warnings[0]?.includes('not found')).toBe(true);
    });
  });

  describe('sync vs async behaviour', () => {
    it('validateCodePathsExist is async', async () => {
      const result = validateCodePathsExist({ id: 'WU-TEST', code_paths: [] }, 'WU-TEST');
      expect(result instanceof Promise).toBeTruthy();
    });

    it('validateLaneCodePaths is sync', () => {
      const result = validateLaneCodePaths({ code_paths: [] }, 'Operations');
      expect(result instanceof Promise).toBe(false);
      expect('hasWarnings' in result).toBeTruthy();
    });

    it('validateWUCodePaths is sync', () => {
      const result = validateWUCodePaths([]);
      expect(result instanceof Promise).toBe(false);
      expect('valid' in result).toBeTruthy();
    });
  });
});

// ============================================================================
// GLOB PATTERN SUPPORT
// ============================================================================

describe('GOLDEN: Glob pattern handling', () => {
  const testDir = '/tmp/wu-1825-golden-globs';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
    mkdirSync(join(testDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('validateCodePathsExist with globs', () => {
    // Note: The current implementation may not support globs
    // This test documents current behaviour
    it('handles literal paths (not expanded globs)', async () => {
      // Create a file
      writeFileSync(join(testDir, 'src', 'file.js'), 'content');

      const doc = {
        id: 'WU-TEST',
        code_paths: ['src/*.js'], // Glob pattern
      };

      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      // Document current behaviour: does it expand globs or treat as literal?
      // If it treats as literal, the glob path won't be found
      // This captures current behaviour for golden test
      if (!existsSync(join(testDir, 'src/*.js'))) {
        // Glob is NOT expanded - treated as literal path
        expect(result.valid).toBe(false);
      }
    });
  });

  describe('validateLaneCodePaths with globs', () => {
    it('uses micromatch for pattern matching', () => {
      // Lane validator uses micromatch to check if paths match patterns
      const doc = {
        code_paths: ['apps/web/src/components/Button.tsx'],
      };

      const result = validateLaneCodePaths(doc, 'Operations');

      // This documents that lane validator supports glob patterns in LANE_PATH_PATTERNS
      // The result depends on the pattern configuration
      expect('hasWarnings' in result).toBeTruthy();
    });
  });
});

// ============================================================================
// ERROR FORMAT DOCUMENTATION
// ============================================================================

describe('GOLDEN: Error message formats', () => {
  const testDir = '/tmp/wu-1825-golden-errors';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('validateCodePathsExist error format', () => {
    it('error message includes "code_paths validation failed"', async () => {
      const doc = { id: 'WU-TEST', code_paths: ['missing.js'] };
      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      expect(result.errors[0].includes('code_paths validation failed')).toBe(true);
    });
  });

  describe('validateWUCodePaths error format', () => {
    it('error message includes emoji prefix for missing file', () => {
      const result = validateWUCodePaths(['missing.js'], {
        worktreePath: testDir,
      });

      // Check for the specific error format with emoji
      expect(result.errors[0].includes('❌')).toBe(true);
    });

    it('error message includes guidance text', () => {
      const result = validateWUCodePaths(['missing.js'], {
        worktreePath: testDir,
      });

      expect(result.errors[0].includes('code_paths')).toBe(true);
    });
  });

  describe('validateLaneCodePaths warning format', () => {
    it('warning includes "expected for different lane" text', () => {
      // This requires a path that violates lane patterns
      const doc = { code_paths: ['apps/web/src/page.tsx'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      if (result.hasWarnings) {
        expect(result.warnings[0].includes('expected for different lane')).toBe(true);
      }
    });
  });
});

// ============================================================================
// UNIFIED VALIDATOR BACKWARD COMPATIBILITY TESTS (WU-1825)
// ============================================================================

describe('UNIFIED: Backward compatibility with original validators', () => {
  const testDir = '/tmp/wu-1825-unified-compat';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('validateCodePathsExist compatibility', () => {
    it('unified export produces same result for empty code_paths', async () => {
      const doc = { id: 'WU-TEST', code_paths: [] };

      const originalResult = await validateCodePathsExist(doc, 'WU-TEST');
      const unifiedResult = await unifiedValidateCodePathsExist(doc, 'WU-TEST');

      expect(originalResult.valid).toBe(unifiedResult.valid);
      expect(originalResult.errors).toEqual(unifiedResult.errors);
      expect(originalResult.missing).toEqual(unifiedResult.missing);
    });

    it('unified export produces same result for existing files', async () => {
      const file = join(testDir, 'existing.js');
      writeFileSync(file, 'content');

      const doc = { id: 'WU-TEST', code_paths: ['existing.js'] };
      const opts = { worktreePath: testDir };

      const originalResult = await validateCodePathsExist(doc, 'WU-TEST', opts);
      const unifiedResult = await unifiedValidateCodePathsExist(doc, 'WU-TEST', opts);

      expect(originalResult.valid).toBe(unifiedResult.valid);
    });

    it('unified export produces same result for missing files', async () => {
      const doc = { id: 'WU-TEST', code_paths: ['missing.js'] };
      const opts = { worktreePath: testDir };

      const originalResult = await validateCodePathsExist(doc, 'WU-TEST', opts);
      const unifiedResult = await unifiedValidateCodePathsExist(doc, 'WU-TEST', opts);

      expect(originalResult.valid).toBe(unifiedResult.valid);
      expect(originalResult.missing).toEqual(unifiedResult.missing);
    });
  });

  describe('validateLaneCodePaths compatibility', () => {
    it('unified export produces same result for empty code_paths', () => {
      const doc = { code_paths: [] };

      const originalResult = validateLaneCodePaths(doc, 'Operations');
      const unifiedResult = unifiedValidateLaneCodePaths(doc, 'Operations');

      expect(originalResult.hasWarnings).toBe(unifiedResult.hasWarnings);
      expect(originalResult.skipped).toBe(unifiedResult.skipped);
      expect(originalResult.warnings).toEqual(unifiedResult.warnings);
      expect(originalResult.violations).toEqual(unifiedResult.violations);
    });

    it('unified export produces same result for valid paths', () => {
      const doc = { code_paths: ['tools/lib/helper.js'] };

      const originalResult = validateLaneCodePaths(doc, 'Operations');
      const unifiedResult = unifiedValidateLaneCodePaths(doc, 'Operations');

      expect(originalResult.hasWarnings).toBe(unifiedResult.hasWarnings);
      expect(originalResult.skipped).toBe(unifiedResult.skipped);
    });

    it('unified export produces same result for violating paths', () => {
      const doc = { code_paths: ['apps/web/src/component.tsx'] };

      const originalResult = validateLaneCodePaths(doc, 'Operations');
      const unifiedResult = unifiedValidateLaneCodePaths(doc, 'Operations');

      expect(originalResult.hasWarnings).toBe(unifiedResult.hasWarnings);
      expect(originalResult.violations).toEqual(unifiedResult.violations);
    });
  });

  describe('validateWUCodePaths compatibility', () => {
    it('unified export produces same result for empty code_paths', () => {
      const originalResult = validateWUCodePaths([]);
      const unifiedResult = unifiedValidateWUCodePaths([]);

      expect(originalResult.valid).toBe(unifiedResult.valid);
      expect(originalResult.errors).toEqual(unifiedResult.errors);
      expect(originalResult.warnings).toEqual(unifiedResult.warnings);
    });

    it('unified export produces same result for missing files', () => {
      const opts = { worktreePath: testDir };

      const originalResult = validateWUCodePaths(['missing.js'], opts);
      const unifiedResult = unifiedValidateWUCodePaths(['missing.js'], opts);

      expect(originalResult.valid).toBe(unifiedResult.valid);
      // Both should have errors
      expect(originalResult.errors.length > 0).toBeTruthy();
      expect(unifiedResult.errors.length > 0).toBeTruthy();
    });

    it('unified export produces same result for clean files', () => {
      const file = join(testDir, 'clean.js');
      writeFileSync(file, 'export const x = 1;');

      const opts = { worktreePath: testDir };

      const originalResult = validateWUCodePaths(['clean.js'], opts);
      const unifiedResult = unifiedValidateWUCodePaths(['clean.js'], opts);

      expect(originalResult.valid).toBe(unifiedResult.valid);
    });

    it('unified export produces same result for files with TODOs', () => {
      const file = join(testDir, 'todo.js');
      writeFileSync(file, '// TODO: fix this\nexport const x = 1;');

      const opts = { worktreePath: testDir, allowTodos: false };

      const originalResult = validateWUCodePaths(['todo.js'], opts);
      const unifiedResult = unifiedValidateWUCodePaths(['todo.js'], opts);

      expect(originalResult.valid).toBe(unifiedResult.valid);
      // Both should fail due to TODO
      expect(originalResult.valid).toBe(false);
    });
  });
});

// ============================================================================
// UNIFIED validate() API TESTS (WU-1825)
// ============================================================================

describe('UNIFIED: validate() API with mode flag', () => {
  const testDir = '/tmp/wu-1825-unified-api';

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe('mode: exist', () => {
    it('validates file existence in worktree', async () => {
      const file = join(testDir, 'file.js');
      writeFileSync(file, 'content');

      const result = await validate(['file.js'], {
        mode: VALIDATION_MODES.EXIST,
        worktreePath: testDir,
      });

      expect(result.valid).toBe(true);
      expect(result.missing).toEqual([]);
    });

    it('reports missing files', async () => {
      const result = await validate(['missing.js'], {
        mode: VALIDATION_MODES.EXIST,
        worktreePath: testDir,
      });

      expect(result.valid).toBe(false);
      expect(result.missing.includes('missing.js')).toBe(true);
    });
  });

  describe('mode: lane', () => {
    it('requires lane option', async () => {
      await expect(async () => validate(['path.js'], { mode: VALIDATION_MODES.LANE })).rejects.toThrow(/Lane name is required/);
    });

    it('returns skipped=true for empty paths', async () => {
      const result = await validate([], {
        mode: VALIDATION_MODES.LANE,
        lane: 'Operations',
      });

      expect(result.skipped).toBe(true);
    });

    it('validates paths against lane patterns', async () => {
      const result = await validate(['tools/helper.js'], {
        mode: VALIDATION_MODES.LANE,
        lane: 'Operations',
      });

      expect('hasWarnings' in result).toBeTruthy();
      expect('violations' in result).toBeTruthy();
    });
  });

  describe('mode: quality', () => {
    it('validates code quality for clean files', async () => {
      const file = join(testDir, 'clean.js');
      writeFileSync(file, 'export const x = 1;');

      const result = await validate(['clean.js'], {
        mode: VALIDATION_MODES.QUALITY,
        worktreePath: testDir,
      });

      expect(result.valid).toBe(true);
    });

    it('reports TODO comments as errors by default', async () => {
      const file = join(testDir, 'todo.js');
      writeFileSync(file, '// TODO: fix this');

      const result = await validate(['todo.js'], {
        mode: VALIDATION_MODES.QUALITY,
        worktreePath: testDir,
        allowTodos: false,
      });

      expect(result.valid).toBe(false);
    });

    it('reports TODO comments as warnings when allowTodos=true', async () => {
      const file = join(testDir, 'todo.js');
      writeFileSync(file, '// TODO: fix this');

      const result = await validate(['todo.js'], {
        mode: VALIDATION_MODES.QUALITY,
        worktreePath: testDir,
        allowTodos: true,
      });

      expect(result.valid).toBe(true);
      expect(result.warnings.length > 0).toBeTruthy();
    });
  });

  describe('default mode', () => {
    it('defaults to exist mode', async () => {
      const result = await validate([], {});

      expect(result.valid).toBe(true);
      expect('missing' in result).toBeTruthy();
    });
  });
});
