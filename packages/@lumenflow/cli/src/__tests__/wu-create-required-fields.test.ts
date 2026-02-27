// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-create-required-fields.test.ts
 * Test suite for wu:create required field aggregation (WU-1366)
 *
 * WU-1366: Missing required fields in wu:create should be reported together
 *          in a single error block.
 *
 * Tests:
 * - Multiple missing required fields are collected and reported together
 * - Error block formatting includes all missing fields
 * - Single missing field still reports correctly
 */

import { describe, it, expect } from 'vitest';
import { validateCreateSpec } from '../wu-create.js';

/** Default lane for test cases */
const TEST_LANE = 'Framework: CLI';
/** Default test WU ID */
const TEST_WU_ID = 'WU-9999';
/** Minimum valid description with required sections */
const VALID_DESCRIPTION =
  'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.';
/** Default acceptance criteria for tests */
const TEST_ACCEPTANCE = ['Acceptance criterion'];

describe('wu:create required field aggregation (WU-1366)', () => {
  describe('validateCreateSpec error aggregation', () => {
    it('should aggregate multiple missing required fields into a single error block', () => {
      // Missing: description, acceptance, exposure, code-paths, test-paths
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          // All required fields missing
          strict: false, // Skip path existence checks
        },
      });

      expect(result.valid).toBe(false);
      // Should have multiple errors collected
      expect(result.errors.length).toBeGreaterThan(1);
      // Verify specific missing fields are included
      expect(result.errors.some((e) => e.includes('--description'))).toBe(true);
      expect(result.errors.some((e) => e.includes('--acceptance'))).toBe(true);
      expect(result.errors.some((e) => e.includes('--exposure'))).toBe(true);
    });

    it('should report missing code-paths for non-documentation WUs', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          description: VALID_DESCRIPTION,
          acceptance: TEST_ACCEPTANCE,
          exposure: 'backend-only',
          // Missing: codePaths, testPaths, specRefs
          strict: false,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('--code-paths'))).toBe(true);
    });

    it('should report spec-refs as missing for feature WUs', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          description: VALID_DESCRIPTION,
          acceptance: TEST_ACCEPTANCE,
          exposure: 'backend-only',
          codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
          testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
          // Missing: specRefs (required for feature type)
          strict: false,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('--spec-refs'))).toBe(true);
    });

    it('rejects automated-only test intent for non-documentation WUs (WU-2263)', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          description: VALID_DESCRIPTION,
          acceptance: TEST_ACCEPTANCE,
          exposure: 'backend-only',
          codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
          // unit test provided, but no manual test — must be rejected per WU-2263
          testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
          specRefs: ['docs/04-operations/tasks/initiatives/INIT-017.yaml'],
          strict: false,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('tests.manual'))).toBe(true);
    });

    it('accepts manual-only test intent for metadata/non-code scope', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          description: VALID_DESCRIPTION,
          acceptance: TEST_ACCEPTANCE,
          exposure: 'backend-only',
          codePaths: ['packages/@lumenflow/cli/package.json'],
          testPathsManual: ['Manual verification step'],
          specRefs: ['docs/04-operations/tasks/initiatives/INIT-017.yaml'],
          strict: false,
        },
      });

      expect(result.valid).toBe(true);
    });

    it('should treat empty spec-refs array as missing for feature WUs', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          description: VALID_DESCRIPTION,
          acceptance: TEST_ACCEPTANCE,
          exposure: 'backend-only',
          codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
          testPathsUnit: [
            'packages/@lumenflow/cli/src/__tests__/wu-create-required-fields.test.ts',
          ],
          specRefs: [],
          strict: false,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('--spec-refs'))).toBe(true);
    });

    it('should return all errors at once, not fail on first error', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          // All required fields missing to ensure multiple errors
          strict: false,
        },
      });

      expect(result.valid).toBe(false);
      // Verify multiple errors are present (at least 3: description, acceptance, exposure)
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('should validate documentation WUs without requiring code-paths', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: 'Content: Documentation',
        title: 'Test Docs WU',
        priority: 'P2',
        type: 'documentation',
        opts: {
          description: VALID_DESCRIPTION,
          acceptance: TEST_ACCEPTANCE,
          exposure: 'documentation',
          testPathsManual: ['Verify docs render correctly'],
          strict: false,
        },
      });

      // Documentation WUs should not require code-paths
      const hasCodePathsError = result.errors.some((e) => e.includes('--code-paths'));
      expect(hasCodePathsError).toBe(false);
    });
  });

  describe('WU-1755: --plan flag satisfies spec-refs for feature WUs (F1)', () => {
    it('should not produce spec-refs error when --plan flag is set', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          description: VALID_DESCRIPTION,
          acceptance: TEST_ACCEPTANCE,
          exposure: 'backend-only',
          codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
          testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
          plan: 'true', // --plan flag set
          strict: false,
        },
      });

      // The --plan flag should prevent the spec-refs error
      expect(result.errors.some((e) => e.includes('--spec-refs'))).toBe(false);
    });

    it('should still require spec-refs for feature WU without --plan flag', () => {
      const result = validateCreateSpec({
        id: TEST_WU_ID,
        lane: TEST_LANE,
        title: 'Test WU',
        priority: 'P2',
        type: 'feature',
        opts: {
          description: VALID_DESCRIPTION,
          acceptance: TEST_ACCEPTANCE,
          exposure: 'backend-only',
          codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
          testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
          // No plan, no specRefs
          strict: false,
        },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('--spec-refs'))).toBe(true);
    });
  });
});
