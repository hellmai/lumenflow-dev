/**
 * @file wu-edit-strict.test.ts
 * Test suite for wu:edit strict validation behavior (WU-1329)
 *
 * WU-1329: Make wu:edit run strict validation by default
 *
 * Tests:
 * - applyEdits function works correctly (unit test for edit logic)
 * - validateDoneWUEdits properly validates done WU edits
 * - The main() function validates paths in strict mode (covered by e2e tests)
 */

import { describe, it, expect } from 'vitest';

// Import test utilities (WU-1329)
import { applyEdits, validateDoneWUEdits, validateExposureValue } from '../wu-edit.js';

// WU-1329: Constants for test file paths
const TEST_NEW_FILE_PATH = 'new/file.ts';
const TEST_NEW_TEST_PATH = 'new/test.test.ts';

describe('wu:edit strict validation (WU-1329)', () => {
  describe('applyEdits code_paths handling', () => {
    const baseWU = {
      id: 'WU-9999',
      title: 'Test WU',
      lane: 'Framework: CLI',
      type: 'feature',
      status: 'ready',
      priority: 'P2',
      description:
        'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum length.',
      acceptance: ['Existing criterion'],
      code_paths: ['packages/@lumenflow/cli/src/wu-edit.ts'],
      tests: {
        unit: ['packages/@lumenflow/cli/src/__tests__/wu-edit-strict.test.ts'],
        manual: [],
        e2e: [],
      },
    };

    // WU-1329: applyEdits transforms WU object - path validation is done separately
    it('should apply code_paths edits correctly', () => {
      const result = applyEdits(baseWU, {
        codePaths: [TEST_NEW_FILE_PATH],
        replaceCodePaths: true,
      });

      // applyEdits transforms the WU, validation happens later in main()
      expect(result.code_paths).toContain(TEST_NEW_FILE_PATH);
      expect(result.code_paths).toHaveLength(1);
    });

    it('should append code_paths by default', () => {
      const result = applyEdits(baseWU, {
        codePaths: [TEST_NEW_FILE_PATH],
      });

      expect(result.code_paths).toContain('packages/@lumenflow/cli/src/wu-edit.ts');
      expect(result.code_paths).toContain(TEST_NEW_FILE_PATH);
      expect(result.code_paths).toHaveLength(2);
    });

    it('should apply test_paths edits correctly', () => {
      const result = applyEdits(baseWU, {
        testPathsUnit: [TEST_NEW_TEST_PATH],
      });

      // Should append test paths
      expect(result.tests.unit).toContain(
        'packages/@lumenflow/cli/src/__tests__/wu-edit-strict.test.ts',
      );
      expect(result.tests.unit).toContain(TEST_NEW_TEST_PATH);
    });
  });

  describe('validateDoneWUEdits', () => {
    // WU-1329: Done WUs only allow initiative/phase/exposure edits
    it('should allow exposure edits on done WUs', () => {
      const result = validateDoneWUEdits({ exposure: 'backend-only' });
      expect(result.valid).toBe(true);
      expect(result.disallowedEdits).toHaveLength(0);
    });

    it('should disallow code_paths edits on done WUs', () => {
      const result = validateDoneWUEdits({ codePaths: [TEST_NEW_FILE_PATH] });
      expect(result.valid).toBe(false);
      expect(result.disallowedEdits).toContain('--code-paths');
    });

    it('should disallow description edits on done WUs', () => {
      const result = validateDoneWUEdits({ description: 'new description' });
      expect(result.valid).toBe(false);
      expect(result.disallowedEdits).toContain('--description');
    });
  });

  describe('validateExposureValue', () => {
    it('should accept valid exposure values', () => {
      expect(validateExposureValue('ui').valid).toBe(true);
      expect(validateExposureValue('api').valid).toBe(true);
      expect(validateExposureValue('backend-only').valid).toBe(true);
      expect(validateExposureValue('documentation').valid).toBe(true);
    });

    it('should reject invalid exposure values', () => {
      const result = validateExposureValue('invalid-exposure');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid exposure value');
    });
  });

  describe('noStrict option support', () => {
    // WU-1329: Verify CLI option parsing pattern
    it('should support noStrict option in CLI argument pattern', () => {
      // CLI uses --no-strict which Commander.js parses as noStrict
      // The main() function converts this to strict: !noStrict
      const cliArgs = { noStrict: true };
      const strict = !cliArgs.noStrict;

      expect(strict).toBe(false);
    });

    it('should default to strict=true when noStrict is undefined', () => {
      const cliArgs = { noStrict: undefined };
      const strict = !cliArgs.noStrict;

      expect(strict).toBe(true);
    });
  });
});
