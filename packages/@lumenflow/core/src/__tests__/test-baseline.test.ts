/**
 * Test Baseline - Test Ratchet Pattern (WU-1253)
 *
 * Tests for the test baseline system that:
 * - Tracks known test failures in a baseline file
 * - Blocks NEW failures while allowing pre-existing ones
 * - Auto-updates baseline when tests are fixed (ratchet forward)
 * - Provides agent guidance about the ratchet rule
 */

 

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TestBaselineSchema,
  parseTestBaseline,
  createTestBaseline,
  compareTestResults,
  updateBaseline,
  formatBaselineWarning,
  formatNewFailureError,
  getBaselineFilePath,
  type TestBaseline,
  type TestResult,
} from '../test-baseline.js';

describe('test-baseline', () => {
  describe('TestBaselineSchema', () => {
    it('should validate a valid baseline file', () => {
      const baseline = {
        version: 1,
        updated_at: '2026-01-30T12:00:00.000Z',
        updated_by: 'WU-1253',
        known_failures: [
          {
            test_name: 'should handle edge case',
            file_path: 'packages/@lumenflow/core/src/__tests__/foo.test.ts',
            failure_reason: 'WU-1210 changed implementation',
            added_at: '2026-01-25T10:00:00.000Z',
            added_by_wu: 'WU-1239',
            expected_fix_wu: 'WU-1300',
          },
        ],
        stats: {
          total_known_failures: 1,
          last_ratchet_forward: '2026-01-28T15:00:00.000Z',
        },
      };

      const result = TestBaselineSchema.safeParse(baseline);
      expect(result.success).toBe(true);
    });

    it('should reject baseline with missing required fields', () => {
      const invalid = {
        version: 1,
        known_failures: [],
        // missing updated_at, updated_by, stats
      };

      const result = TestBaselineSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject baseline with invalid version', () => {
      const invalid = {
        version: 0, // must be 1
        updated_at: '2026-01-30T12:00:00.000Z',
        updated_by: 'WU-1253',
        known_failures: [],
        stats: {
          total_known_failures: 0,
        },
      };

      const result = TestBaselineSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it('should validate known_failures entry with all fields', () => {
      const baseline = {
        version: 1,
        updated_at: '2026-01-30T12:00:00.000Z',
        updated_by: 'WU-1253',
        known_failures: [
          {
            test_name: 'test name',
            file_path: 'path/to/test.ts',
            failure_reason: 'reason',
            added_at: '2026-01-25T10:00:00.000Z',
            added_by_wu: 'WU-1200',
            expected_fix_wu: 'WU-1300',
            skip_reason: 'Optional skip reason',
          },
        ],
        stats: {
          total_known_failures: 1,
          last_ratchet_forward: '2026-01-28T15:00:00.000Z',
        },
      };

      const result = TestBaselineSchema.safeParse(baseline);
      expect(result.success).toBe(true);
    });
  });

  describe('parseTestBaseline', () => {
    it('should parse valid JSON baseline file', () => {
      const json = JSON.stringify({
        version: 1,
        updated_at: '2026-01-30T12:00:00.000Z',
        updated_by: 'WU-1253',
        known_failures: [],
        stats: { total_known_failures: 0 },
      });

      const result = parseTestBaseline(json);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.version).toBe(1);
        expect(result.data.known_failures).toEqual([]);
      }
    });

    it('should return error for invalid JSON', () => {
      const result = parseTestBaseline('not valid json');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('Invalid JSON');
      }
    });

    it('should return error for schema validation failure', () => {
      const json = JSON.stringify({ version: 'invalid' });
      const result = parseTestBaseline(json);
      expect(result.success).toBe(false);
    });
  });

  describe('createTestBaseline', () => {
    it('should create empty baseline with correct structure', () => {
      const baseline = createTestBaseline('WU-1253');

      expect(baseline.version).toBe(1);
      expect(baseline.updated_by).toBe('WU-1253');
      expect(baseline.known_failures).toEqual([]);
      expect(baseline.stats.total_known_failures).toBe(0);
      expect(baseline.updated_at).toBeDefined();
    });

    it('should create baseline with initial failures', () => {
      const failures = [
        {
          test_name: 'test foo',
          file_path: 'test.ts',
          failure_reason: 'broken',
          expected_fix_wu: 'WU-1300',
        },
      ];

      const baseline = createTestBaseline('WU-1253', failures);

      expect(baseline.known_failures).toHaveLength(1);
      expect(baseline.known_failures[0].test_name).toBe('test foo');
      expect(baseline.known_failures[0].added_by_wu).toBe('WU-1253');
      expect(baseline.stats.total_known_failures).toBe(1);
    });
  });

  describe('compareTestResults', () => {
    let baseline: TestBaseline;

    beforeEach(() => {
      baseline = {
        version: 1,
        updated_at: '2026-01-30T12:00:00.000Z',
        updated_by: 'WU-1200',
        known_failures: [
          {
            test_name: 'known failing test',
            file_path: 'path/to/test.ts',
            failure_reason: 'pre-existing',
            added_at: '2026-01-25T10:00:00.000Z',
            added_by_wu: 'WU-1100',
            expected_fix_wu: 'WU-1300',
          },
        ],
        stats: {
          total_known_failures: 1,
        },
      };
    });

    it('should detect NEW failures (not in baseline)', () => {
      const currentFailures: TestResult[] = [
        {
          test_name: 'NEW failing test',
          file_path: 'path/to/new-test.ts',
          passed: false,
          error_message: 'assertion failed',
        },
      ];

      const comparison = compareTestResults(baseline, currentFailures);

      expect(comparison.newFailures).toHaveLength(1);
      expect(comparison.newFailures[0].test_name).toBe('NEW failing test');
      expect(comparison.preExistingFailures).toHaveLength(0);
      expect(comparison.fixedTests).toHaveLength(1); // known failure is now passing
      expect(comparison.shouldBlock).toBe(true);
    });

    it('should allow pre-existing failures with warning', () => {
      const currentFailures: TestResult[] = [
        {
          test_name: 'known failing test',
          file_path: 'path/to/test.ts',
          passed: false,
          error_message: 'still failing',
        },
      ];

      const comparison = compareTestResults(baseline, currentFailures);

      expect(comparison.newFailures).toHaveLength(0);
      expect(comparison.preExistingFailures).toHaveLength(1);
      expect(comparison.preExistingFailures[0].test_name).toBe('known failing test');
      expect(comparison.fixedTests).toHaveLength(0);
      expect(comparison.shouldBlock).toBe(false);
      expect(comparison.hasWarnings).toBe(true);
    });

    it('should detect fixed tests (ratchet forward candidates)', () => {
      // No current failures - known failure was fixed
      const currentFailures: TestResult[] = [];

      const comparison = compareTestResults(baseline, currentFailures);

      expect(comparison.fixedTests).toHaveLength(1);
      expect(comparison.fixedTests[0].test_name).toBe('known failing test');
      expect(comparison.shouldRatchetForward).toBe(true);
    });

    it('should handle all tests passing with empty baseline', () => {
      const emptyBaseline = createTestBaseline('WU-1253');
      const currentFailures: TestResult[] = [];

      const comparison = compareTestResults(emptyBaseline, currentFailures);

      expect(comparison.newFailures).toHaveLength(0);
      expect(comparison.preExistingFailures).toHaveLength(0);
      expect(comparison.fixedTests).toHaveLength(0);
      expect(comparison.shouldBlock).toBe(false);
      expect(comparison.hasWarnings).toBe(false);
    });

    it('should handle mix of new, pre-existing, and fixed failures', () => {
      const multiBaseline: TestBaseline = {
        ...baseline,
        known_failures: [
          ...baseline.known_failures,
          {
            test_name: 'another known failure',
            file_path: 'path/to/other.ts',
            failure_reason: 'also broken',
            added_at: '2026-01-26T10:00:00.000Z',
            added_by_wu: 'WU-1150',
          },
        ],
        stats: { total_known_failures: 2 },
      };

      const currentFailures: TestResult[] = [
        {
          // Pre-existing: still failing
          test_name: 'known failing test',
          file_path: 'path/to/test.ts',
          passed: false,
          error_message: 'still broken',
        },
        // 'another known failure' is NOT in currentFailures = fixed
        {
          // NEW: not in baseline
          test_name: 'brand new failure',
          file_path: 'new/path.ts',
          passed: false,
          error_message: 'new bug',
        },
      ];

      const comparison = compareTestResults(multiBaseline, currentFailures);

      expect(comparison.newFailures).toHaveLength(1);
      expect(comparison.preExistingFailures).toHaveLength(1);
      expect(comparison.fixedTests).toHaveLength(1);
      expect(comparison.shouldBlock).toBe(true); // NEW failure blocks
      expect(comparison.shouldRatchetForward).toBe(true); // fixed test triggers ratchet
    });
  });

  describe('updateBaseline', () => {
    let baseline: TestBaseline;

    beforeEach(() => {
      baseline = {
        version: 1,
        updated_at: '2026-01-30T12:00:00.000Z',
        updated_by: 'WU-1200',
        known_failures: [
          {
            test_name: 'will be fixed',
            file_path: 'path/to/test.ts',
            failure_reason: 'old issue',
            added_at: '2026-01-25T10:00:00.000Z',
            added_by_wu: 'WU-1100',
          },
        ],
        stats: {
          total_known_failures: 1,
        },
      };
    });

    it('should remove fixed tests from baseline (ratchet forward)', () => {
      const fixedTests = ['will be fixed'];
      const updated = updateBaseline(baseline, 'WU-1253', { fixedTests });

      expect(updated.known_failures).toHaveLength(0);
      expect(updated.stats.total_known_failures).toBe(0);
      expect(updated.updated_by).toBe('WU-1253');
      expect(updated.stats.last_ratchet_forward).toBeDefined();
    });

    it('should add new known failures to baseline', () => {
      const newKnownFailures = [
        {
          test_name: 'new known failure',
          file_path: 'new/test.ts',
          failure_reason: 'infrastructure issue',
          expected_fix_wu: 'WU-1300',
        },
      ];
      const updated = updateBaseline(baseline, 'WU-1253', { newKnownFailures });

      expect(updated.known_failures).toHaveLength(2);
      expect(updated.known_failures[1].test_name).toBe('new known failure');
      expect(updated.known_failures[1].added_by_wu).toBe('WU-1253');
      expect(updated.stats.total_known_failures).toBe(2);
    });

    it('should not modify original baseline (immutability)', () => {
      const originalLength = baseline.known_failures.length;
      const originalUpdatedAt = baseline.updated_at;

      updateBaseline(baseline, 'WU-1253', { fixedTests: ['will be fixed'] });

      expect(baseline.known_failures.length).toBe(originalLength);
      expect(baseline.updated_at).toBe(originalUpdatedAt);
    });
  });

  describe('formatBaselineWarning', () => {
    it('should format warning for pre-existing failures', () => {
      const preExisting = [
        {
          test_name: 'known failing test',
          file_path: 'path/to/test.ts',
          failure_reason: 'pre-existing',
          added_at: '2026-01-25T10:00:00.000Z',
          added_by_wu: 'WU-1100',
          expected_fix_wu: 'WU-1300',
        },
      ];

      const warning = formatBaselineWarning(preExisting);

      expect(warning).toContain('Pre-existing test failures');
      expect(warning).toContain('known failing test');
      expect(warning).toContain('WU-1300');
      expect(warning).toContain('These failures are tracked');
    });
  });

  describe('formatNewFailureError', () => {
    it('should format error for new failures', () => {
      const newFailures: TestResult[] = [
        {
          test_name: 'NEW failing test',
          file_path: 'path/to/new-test.ts',
          passed: false,
          error_message: 'assertion failed',
        },
      ];

      const error = formatNewFailureError(newFailures);

      expect(error).toContain('NEW test failure');
      expect(error).toContain('NEW failing test');
      expect(error).toContain('Fix the test or add to baseline');
      expect(error).toContain('pnpm baseline:add');
    });
  });

  describe('getBaselineFilePath', () => {
    it('should return default path when no custom path', () => {
      const path = getBaselineFilePath();
      expect(path).toBe('.lumenflow/test-baseline.json');
    });

    it('should return custom path when LUMENFLOW_TEST_BASELINE env is set', () => {
      const original = process.env.LUMENFLOW_TEST_BASELINE;
      process.env.LUMENFLOW_TEST_BASELINE = '/custom/path/baseline.json';

      const path = getBaselineFilePath();
      expect(path).toBe('/custom/path/baseline.json');

      // Restore
      if (original === undefined) {
        delete process.env.LUMENFLOW_TEST_BASELINE;
      } else {
        process.env.LUMENFLOW_TEST_BASELINE = original;
      }
    });
  });
});

describe('test-baseline integration with gates', () => {
  describe('ratchet forward behavior', () => {
    it('should detect when baseline should be updated after tests pass', () => {
      const baseline: TestBaseline = {
        version: 1,
        updated_at: '2026-01-30T12:00:00.000Z',
        updated_by: 'WU-1200',
        known_failures: [
          {
            test_name: 'was failing now fixed',
            file_path: 'test.ts',
            failure_reason: 'old bug',
            added_at: '2026-01-25T10:00:00.000Z',
            added_by_wu: 'WU-1100',
          },
        ],
        stats: { total_known_failures: 1 },
      };

      // All tests pass - the known failure was fixed
      const comparison = compareTestResults(baseline, []);

      expect(comparison.shouldRatchetForward).toBe(true);
      expect(comparison.fixedTests).toHaveLength(1);
    });
  });

  describe('skip-gates integration', () => {
    it('should provide skip-gates compatible output for pre-existing failures', () => {
      const baseline: TestBaseline = {
        version: 1,
        updated_at: '2026-01-30T12:00:00.000Z',
        updated_by: 'WU-1200',
        known_failures: [
          {
            test_name: 'infrastructure issue',
            file_path: 'test.ts',
            failure_reason: 'CI flakiness',
            added_at: '2026-01-25T10:00:00.000Z',
            added_by_wu: 'WU-1100',
            expected_fix_wu: 'WU-1300',
          },
        ],
        stats: { total_known_failures: 1 },
      };

      const currentFailures: TestResult[] = [
        {
          test_name: 'infrastructure issue',
          file_path: 'test.ts',
          passed: false,
          error_message: 'flaky test',
        },
      ];

      const comparison = compareTestResults(baseline, currentFailures);

      // Pre-existing failures should not block
      expect(comparison.shouldBlock).toBe(false);
      // But they should generate warnings
      expect(comparison.hasWarnings).toBe(true);
      // And provide fix-wu reference for skip-gates if needed
      expect(comparison.preExistingFailures[0].expected_fix_wu).toBe('WU-1300');
    });
  });
});
