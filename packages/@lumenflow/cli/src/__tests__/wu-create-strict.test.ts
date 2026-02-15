/**
 * @file wu-create-strict.test.ts
 * Test suite for wu:create strict validation behavior (WU-1329)
 *
 * WU-1329/WU-1680: create phase is intent-only; reality checks run at prep/done.
 *
 * Tests:
 * - create validation is intent/structural and does not require existing files on disk
 * - --no-strict remains accepted for compatibility and emits advisory log
 * - --no-strict usage is logged
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import test utilities (WU-1329)
import { validateCreateSpec } from '../wu-create.js';

// WU-1329: Constants for test file paths
const NON_EXISTENT_CODE_PATH = 'non-existent/file.ts';
const NON_EXISTENT_TEST_PATH = 'non-existent/test.test.ts';

describe('wu:create strict validation (WU-1329)', () => {
  describe('validateCreateSpec strict mode', () => {
    const baseOpts = {
      id: 'WU-9999',
      lane: 'Framework: CLI',
      title: 'Test WU',
      priority: 'P2',
      type: 'feature',
      opts: {
        description:
          'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum length requirement.',
        acceptance: ['Acceptance criterion 1'],
        codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
        testPathsManual: ['Run pnpm wu:create with valid spec and verify success'],
        testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create-strict.test.ts'],
        exposure: 'backend-only',
        specRefs: ['lumenflow://plans/WU-9999-plan.md'],
      },
    };

    it('should pass validation with valid spec in non-strict mode', () => {
      const result = validateCreateSpec({
        ...baseOpts,
        opts: {
          ...baseOpts.opts,
          strict: false,
        },
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('does not require code_paths existence during create validation', () => {
      const result = validateCreateSpec({
        ...baseOpts,
        opts: {
          ...baseOpts.opts,
          codePaths: [NON_EXISTENT_CODE_PATH],
          // strict is not explicitly set - should default to true
        },
      });

      expect(result.valid).toBe(true);
    });

    it('also passes with strict=false (compatibility mode)', () => {
      const result = validateCreateSpec({
        ...baseOpts,
        opts: {
          ...baseOpts.opts,
          codePaths: [NON_EXISTENT_CODE_PATH],
          strict: false,
        },
      });

      expect(result.valid).toBe(true);
    });

    it('does not require automated test path existence during create validation', () => {
      const result = validateCreateSpec({
        ...baseOpts,
        opts: {
          ...baseOpts.opts,
          testPathsUnit: [NON_EXISTENT_TEST_PATH],
        },
      });

      expect(result.valid).toBe(true);
    });
  });

  describe('--no-strict logging', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    // WU-1329: This test verifies --no-strict usage is logged
    it('should log warning when --no-strict is used', () => {
      validateCreateSpec({
        id: 'WU-9999',
        lane: 'Framework: CLI',
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          description:
            'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.',
          acceptance: ['Acceptance criterion'],
          codePaths: [NON_EXISTENT_CODE_PATH],
          testPathsUnit: [NON_EXISTENT_TEST_PATH],
          exposure: 'backend-only',
          specRefs: ['lumenflow://plans/WU-9999-plan.md'],
          strict: false,
        },
      });

      // Should log that strict validation was bypassed
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('strict validation bypassed'),
      );
    });
  });
});
