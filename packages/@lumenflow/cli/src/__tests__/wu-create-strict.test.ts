/**
 * @file wu-create-strict.test.ts
 * Test suite for wu:create strict validation behavior (WU-1329)
 *
 * WU-1329: Make wu:create run strict validation by default
 *
 * Tests:
 * - Strict validation runs by default (validates code_paths/test_paths exist)
 * - --no-strict flag bypasses strict validation
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

    // WU-1329: This test verifies that strict validation is the default
    it('should validate code_paths existence by default (strict=true)', () => {
      const result = validateCreateSpec({
        ...baseOpts,
        opts: {
          ...baseOpts.opts,
          codePaths: [NON_EXISTENT_CODE_PATH],
          // strict is not explicitly set - should default to true
        },
      });

      // In strict mode, non-existent paths should be caught
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('code_paths') || e.includes('not found'))).toBe(
        true,
      );
    });

    // WU-1329: This test verifies --no-strict bypasses path validation
    it('should skip code_paths existence check when strict=false', () => {
      const result = validateCreateSpec({
        ...baseOpts,
        opts: {
          ...baseOpts.opts,
          codePaths: [NON_EXISTENT_CODE_PATH],
          strict: false,
        },
      });

      // In non-strict mode, non-existent paths should not fail validation
      // (other schema validation may still fail)
      expect(
        result.errors.every((e) => !e.includes('not found') && !e.includes('does not exist')),
      ).toBe(true);
    });

    // WU-1329: This test verifies test_paths validation in strict mode
    it('should validate test_paths existence by default (strict=true)', () => {
      const result = validateCreateSpec({
        ...baseOpts,
        opts: {
          ...baseOpts.opts,
          testPathsUnit: [NON_EXISTENT_TEST_PATH],
        },
      });

      // In strict mode, non-existent test paths should be caught
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('test') || e.includes('not found'))).toBe(true);
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
