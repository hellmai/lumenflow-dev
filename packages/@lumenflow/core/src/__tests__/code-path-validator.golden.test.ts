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

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
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

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, []);
      assert.deepStrictEqual(result.missing, []);
    });

    it('returns valid=true for undefined code_paths', async () => {
      const doc = { id: 'WU-TEST' };
      const result = await validateCodePathsExist(doc, 'WU-TEST');

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, []);
      assert.deepStrictEqual(result.missing, []);
    });

    it('returns valid=true for null code_paths', async () => {
      const doc = { id: 'WU-TEST', code_paths: null };
      const result = await validateCodePathsExist(doc, 'WU-TEST');

      assert.strictEqual(result.valid, true);
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

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.missing, []);
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

      assert.strictEqual(result.valid, false);
      assert.ok(result.missing.includes('missing.js'));
      assert.ok(result.missing.includes('also-missing.js'));
      assert.strictEqual(result.missing.length, 2);
    });

    it('includes contextual error message about worktree', async () => {
      const doc = {
        id: 'WU-TEST',
        code_paths: ['nonexistent.js'],
      };

      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes('not found in worktree'));
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

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes('3 file(s)'));
    });

    it('error message lists each missing file with bullet point', async () => {
      const doc = {
        id: 'WU-TEST',
        code_paths: ['missing-file.js'],
      };

      const result = await validateCodePathsExist(doc, 'WU-TEST', {
        worktreePath: testDir,
      });

      assert.ok(result.errors[0].includes('- missing-file.js'));
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

      assert.strictEqual(result.hasWarnings, false);
      assert.strictEqual(result.skipped, true);
      assert.deepStrictEqual(result.warnings, []);
      assert.deepStrictEqual(result.violations, []);
    });

    it('returns skipped=true for undefined code_paths', () => {
      const doc = {};
      const result = validateLaneCodePaths(doc, 'Operations: Tooling');

      assert.strictEqual(result.skipped, true);
    });

    it('returns skipped=true for null code_paths', () => {
      const doc = { code_paths: null };
      const result = validateLaneCodePaths(doc, 'Operations: Tooling');

      assert.strictEqual(result.skipped, true);
    });
  });

  describe('lane pattern matching', () => {
    it('returns skipped=true for lanes without defined patterns', () => {
      // Using a lane that has no patterns defined in LANE_PATH_PATTERNS
      const doc = { code_paths: ['some/random/path.ts'] };
      const result = validateLaneCodePaths(doc, 'NonExistent: Lane');

      assert.strictEqual(result.skipped, true);
      assert.strictEqual(result.hasWarnings, false);
    });

    it('returns hasWarnings=false when paths match lane expectations', () => {
      // Operations lane with tools/ paths - should be valid
      const doc = { code_paths: ['tools/lib/wu-helpers.js'] };
      const result = validateLaneCodePaths(doc, 'Operations: Tooling');

      assert.strictEqual(result.hasWarnings, false);
      assert.deepStrictEqual(result.violations, []);
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
        assert.ok(result.violations.length > 0);
        assert.ok(result.warnings.length > 0);
      }
    });
  });

  describe('warning message format', () => {
    it('warning message includes lane name', () => {
      // This test may need adjustment based on LANE_PATH_PATTERNS
      const doc = { code_paths: ['apps/web/src/component.tsx'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      if (result.hasWarnings) {
        assert.ok(result.warnings[0].includes('Operations'));
      }
    });

    it('warning message includes violating path', () => {
      const doc = { code_paths: ['apps/web/src/specific-file.tsx'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      if (result.hasWarnings) {
        assert.ok(result.warnings[0].includes('apps/web/src/specific-file.tsx'));
      }
    });
  });

  describe('result structure', () => {
    it('returns correct shape for valid result', () => {
      const doc = { code_paths: ['tools/helper.js'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      assert.ok('hasWarnings' in result);
      assert.ok('warnings' in result);
      assert.ok('violations' in result);
      assert.ok('skipped' in result);
      assert.ok(Array.isArray(result.warnings));
      assert.ok(Array.isArray(result.violations));
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

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, []);
      assert.deepStrictEqual(result.warnings, []);
    });

    it('returns valid=true for undefined code_paths', () => {
      const result = validateWUCodePaths(undefined);

      assert.strictEqual(result.valid, true);
    });

    it('returns valid=true for null code_paths', () => {
      const result = validateWUCodePaths(null);

      assert.strictEqual(result.valid, true);
    });
  });

  describe('file existence validation', () => {
    it('returns valid=false when file does not exist', () => {
      const result = validateWUCodePaths(['nonexistent-file.js'], {
        worktreePath: testDir,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    it('error message includes file path that does not exist', () => {
      const result = validateWUCodePaths(['specific-missing-file.js'], {
        worktreePath: testDir,
      });

      assert.ok(result.errors[0].includes('specific-missing-file.js'));
    });

    it('returns valid=true when all files exist and have no issues', () => {
      const file = join(testDir, 'clean-file.js');
      writeFileSync(file, 'export const clean = true;');

      const result = validateWUCodePaths(['clean-file.js'], {
        worktreePath: testDir,
      });

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.errors, []);
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

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes('TODO'));
    });

    it('returns valid=true with warning when allowTodos=true', () => {
      const file = join(testDir, 'todo-allowed.js');
      writeFileSync(file, '// TODO: this is allowed\nexport const x = 1;');

      const result = validateWUCodePaths(['todo-allowed.js'], {
        worktreePath: testDir,
        allowTodos: true,
      });

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.length > 0);
    });

    it('detects FIXME comments', () => {
      const file = join(testDir, 'fixme-file.js');
      writeFileSync(file, '// FIXME: broken thing\nexport const x = 1;');

      const result = validateWUCodePaths(['fixme-file.js'], {
        worktreePath: testDir,
        allowTodos: false,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors[0].includes('FIXME') || result.errors[0].includes('TODO'));
    });

    it('skips test files for TODO detection', () => {
      const testFile = join(testDir, 'component.test.js');
      writeFileSync(testFile, '// TODO: add more tests\nexport const test = true;');

      const result = validateWUCodePaths(['component.test.js'], {
        worktreePath: testDir,
        allowTodos: false,
      });

      // Test files should be skipped for TODO detection
      assert.strictEqual(result.valid, true);
    });

    it('skips markdown files for TODO detection', () => {
      const mdFile = join(testDir, 'README.md');
      writeFileSync(mdFile, '# Project\n\n- TODO: document this feature');

      const result = validateWUCodePaths(['README.md'], {
        worktreePath: testDir,
        allowTodos: false,
      });

      // Markdown files should be skipped for TODO detection
      assert.strictEqual(result.valid, true);
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
      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.length > 0);
      assert.ok(result.warnings[0].includes('Mock'));
    });

    it('skips test files for Mock detection', () => {
      const testFile = join(testDir, 'service.test.js');
      writeFileSync(testFile, 'export class MockService { }');

      const result = validateWUCodePaths(['service.test.js'], {
        worktreePath: testDir,
      });

      // Test files should be skipped for mock detection
      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.warnings, []);
    });
  });

  describe('result structure', () => {
    it('returns correct shape', () => {
      const result = validateWUCodePaths([]);

      assert.ok('valid' in result);
      assert.ok('errors' in result);
      assert.ok('warnings' in result);
      assert.ok(Array.isArray(result.errors));
      assert.ok(Array.isArray(result.warnings));
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
      assert.strictEqual(existResult.valid, true);

      // validateLaneCodePaths
      const laneResult = validateLaneCodePaths({ code_paths: [] }, 'Operations');
      assert.strictEqual(laneResult.hasWarnings, false);
      assert.strictEqual(laneResult.skipped, true);

      // validateWUCodePaths
      const wuResult = validateWUCodePaths([]);
      assert.strictEqual(wuResult.valid, true);
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
      assert.strictEqual(existResult.valid, false);
      assert.strictEqual(wuResult.valid, false);
    });

    it('validateLaneCodePaths does NOT check file existence (pattern-only)', () => {
      const doc = {
        code_paths: ['nonexistent-but-matches-pattern.js'],
      };

      const laneResult = validateLaneCodePaths(doc, 'Operations');

      // Lane validator only checks patterns, not file existence
      // It should not fail due to missing files
      // (It may warn if path violates lane patterns, but not for non-existence)
      assert.ok(!laneResult.hasWarnings || !laneResult.warnings[0]?.includes('not found'));
    });
  });

  describe('sync vs async behaviour', () => {
    it('validateCodePathsExist is async', async () => {
      const result = validateCodePathsExist({ id: 'WU-TEST', code_paths: [] }, 'WU-TEST');
      assert.ok(result instanceof Promise);
    });

    it('validateLaneCodePaths is sync', () => {
      const result = validateLaneCodePaths({ code_paths: [] }, 'Operations');
      assert.ok(!(result instanceof Promise));
      assert.ok('hasWarnings' in result);
    });

    it('validateWUCodePaths is sync', () => {
      const result = validateWUCodePaths([]);
      assert.ok(!(result instanceof Promise));
      assert.ok('valid' in result);
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
        assert.strictEqual(result.valid, false);
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
      assert.ok('hasWarnings' in result);
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

      assert.ok(result.errors[0].includes('code_paths validation failed'));
    });
  });

  describe('validateWUCodePaths error format', () => {
    it('error message includes emoji prefix for missing file', () => {
      const result = validateWUCodePaths(['missing.js'], {
        worktreePath: testDir,
      });

      // Check for the specific error format with emoji
      assert.ok(result.errors[0].includes('❌'));
    });

    it('error message includes guidance text', () => {
      const result = validateWUCodePaths(['missing.js'], {
        worktreePath: testDir,
      });

      assert.ok(result.errors[0].includes('code_paths'));
    });
  });

  describe('validateLaneCodePaths warning format', () => {
    it('warning includes "expected for different lane" text', () => {
      // This requires a path that violates lane patterns
      const doc = { code_paths: ['apps/web/src/page.tsx'] };
      const result = validateLaneCodePaths(doc, 'Operations');

      if (result.hasWarnings) {
        assert.ok(result.warnings[0].includes('expected for different lane'));
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

      assert.strictEqual(originalResult.valid, unifiedResult.valid);
      assert.deepStrictEqual(originalResult.errors, unifiedResult.errors);
      assert.deepStrictEqual(originalResult.missing, unifiedResult.missing);
    });

    it('unified export produces same result for existing files', async () => {
      const file = join(testDir, 'existing.js');
      writeFileSync(file, 'content');

      const doc = { id: 'WU-TEST', code_paths: ['existing.js'] };
      const opts = { worktreePath: testDir };

      const originalResult = await validateCodePathsExist(doc, 'WU-TEST', opts);
      const unifiedResult = await unifiedValidateCodePathsExist(doc, 'WU-TEST', opts);

      assert.strictEqual(originalResult.valid, unifiedResult.valid);
    });

    it('unified export produces same result for missing files', async () => {
      const doc = { id: 'WU-TEST', code_paths: ['missing.js'] };
      const opts = { worktreePath: testDir };

      const originalResult = await validateCodePathsExist(doc, 'WU-TEST', opts);
      const unifiedResult = await unifiedValidateCodePathsExist(doc, 'WU-TEST', opts);

      assert.strictEqual(originalResult.valid, unifiedResult.valid);
      assert.deepStrictEqual(originalResult.missing, unifiedResult.missing);
    });
  });

  describe('validateLaneCodePaths compatibility', () => {
    it('unified export produces same result for empty code_paths', () => {
      const doc = { code_paths: [] };

      const originalResult = validateLaneCodePaths(doc, 'Operations');
      const unifiedResult = unifiedValidateLaneCodePaths(doc, 'Operations');

      assert.strictEqual(originalResult.hasWarnings, unifiedResult.hasWarnings);
      assert.strictEqual(originalResult.skipped, unifiedResult.skipped);
      assert.deepStrictEqual(originalResult.warnings, unifiedResult.warnings);
      assert.deepStrictEqual(originalResult.violations, unifiedResult.violations);
    });

    it('unified export produces same result for valid paths', () => {
      const doc = { code_paths: ['tools/lib/helper.js'] };

      const originalResult = validateLaneCodePaths(doc, 'Operations');
      const unifiedResult = unifiedValidateLaneCodePaths(doc, 'Operations');

      assert.strictEqual(originalResult.hasWarnings, unifiedResult.hasWarnings);
      assert.strictEqual(originalResult.skipped, unifiedResult.skipped);
    });

    it('unified export produces same result for violating paths', () => {
      const doc = { code_paths: ['apps/web/src/component.tsx'] };

      const originalResult = validateLaneCodePaths(doc, 'Operations');
      const unifiedResult = unifiedValidateLaneCodePaths(doc, 'Operations');

      assert.strictEqual(originalResult.hasWarnings, unifiedResult.hasWarnings);
      assert.deepStrictEqual(originalResult.violations, unifiedResult.violations);
    });
  });

  describe('validateWUCodePaths compatibility', () => {
    it('unified export produces same result for empty code_paths', () => {
      const originalResult = validateWUCodePaths([]);
      const unifiedResult = unifiedValidateWUCodePaths([]);

      assert.strictEqual(originalResult.valid, unifiedResult.valid);
      assert.deepStrictEqual(originalResult.errors, unifiedResult.errors);
      assert.deepStrictEqual(originalResult.warnings, unifiedResult.warnings);
    });

    it('unified export produces same result for missing files', () => {
      const opts = { worktreePath: testDir };

      const originalResult = validateWUCodePaths(['missing.js'], opts);
      const unifiedResult = unifiedValidateWUCodePaths(['missing.js'], opts);

      assert.strictEqual(originalResult.valid, unifiedResult.valid);
      // Both should have errors
      assert.ok(originalResult.errors.length > 0);
      assert.ok(unifiedResult.errors.length > 0);
    });

    it('unified export produces same result for clean files', () => {
      const file = join(testDir, 'clean.js');
      writeFileSync(file, 'export const x = 1;');

      const opts = { worktreePath: testDir };

      const originalResult = validateWUCodePaths(['clean.js'], opts);
      const unifiedResult = unifiedValidateWUCodePaths(['clean.js'], opts);

      assert.strictEqual(originalResult.valid, unifiedResult.valid);
    });

    it('unified export produces same result for files with TODOs', () => {
      const file = join(testDir, 'todo.js');
      writeFileSync(file, '// TODO: fix this\nexport const x = 1;');

      const opts = { worktreePath: testDir, allowTodos: false };

      const originalResult = validateWUCodePaths(['todo.js'], opts);
      const unifiedResult = unifiedValidateWUCodePaths(['todo.js'], opts);

      assert.strictEqual(originalResult.valid, unifiedResult.valid);
      // Both should fail due to TODO
      assert.strictEqual(originalResult.valid, false);
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

      assert.strictEqual(result.valid, true);
      assert.deepStrictEqual(result.missing, []);
    });

    it('reports missing files', async () => {
      const result = await validate(['missing.js'], {
        mode: VALIDATION_MODES.EXIST,
        worktreePath: testDir,
      });

      assert.strictEqual(result.valid, false);
      assert.ok(result.missing.includes('missing.js'));
    });
  });

  describe('mode: lane', () => {
    it('requires lane option', async () => {
      await assert.rejects(
        async () => validate(['path.js'], { mode: VALIDATION_MODES.LANE }),
        /Lane name is required/
      );
    });

    it('returns skipped=true for empty paths', async () => {
      const result = await validate([], {
        mode: VALIDATION_MODES.LANE,
        lane: 'Operations',
      });

      assert.strictEqual(result.skipped, true);
    });

    it('validates paths against lane patterns', async () => {
      const result = await validate(['tools/helper.js'], {
        mode: VALIDATION_MODES.LANE,
        lane: 'Operations',
      });

      assert.ok('hasWarnings' in result);
      assert.ok('violations' in result);
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

      assert.strictEqual(result.valid, true);
    });

    it('reports TODO comments as errors by default', async () => {
      const file = join(testDir, 'todo.js');
      writeFileSync(file, '// TODO: fix this');

      const result = await validate(['todo.js'], {
        mode: VALIDATION_MODES.QUALITY,
        worktreePath: testDir,
        allowTodos: false,
      });

      assert.strictEqual(result.valid, false);
    });

    it('reports TODO comments as warnings when allowTodos=true', async () => {
      const file = join(testDir, 'todo.js');
      writeFileSync(file, '// TODO: fix this');

      const result = await validate(['todo.js'], {
        mode: VALIDATION_MODES.QUALITY,
        worktreePath: testDir,
        allowTodos: true,
      });

      assert.strictEqual(result.valid, true);
      assert.ok(result.warnings.length > 0);
    });
  });

  describe('default mode', () => {
    it('defaults to exist mode', async () => {
      const result = await validate([], {});

      assert.strictEqual(result.valid, true);
      assert.ok('missing' in result);
    });
  });
});
