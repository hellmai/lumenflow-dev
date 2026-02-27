// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-create-manual-test-policy.test.ts
 * WU-2263: Regression tests ensuring wu:create --validate enforces the same
 * tests.manual policy as wu:claim (WU-1508).
 *
 * Bug: wu:create allowed non-doc WUs with tests.manual empty when other test
 * buckets were populated. wu:claim then hard-failed the same WU.
 */

import { describe, it, expect } from 'vitest';
import { validateCreateSpec } from '../wu-create-validation.js';

const TEST_LANE = 'Framework: CLI';
const TEST_WU_ID = 'WU-9999';
const VALID_DESCRIPTION =
  'Context: test context.\nProblem: test problem.\nSolution: test solution that exceeds minimum.';
const TEST_ACCEPTANCE = ['Acceptance criterion'];

describe('wu:create manual test policy alignment (WU-2263)', () => {
  it('rejects non-doc WU with unit tests but no manual tests', () => {
    const result = validateCreateSpec({
      id: TEST_WU_ID,
      lane: TEST_LANE,
      title: 'Test WU',
      priority: 'P2',
      type: 'bug',
      opts: {
        description: VALID_DESCRIPTION,
        acceptance: TEST_ACCEPTANCE,
        exposure: 'backend-only',
        codePaths: ['packages/@lumenflow/cli/src/wu-create-validation.ts'],
        testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
        strict: false,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('tests.manual'))).toBe(true);
  });

  it('rejects non-doc WU with e2e tests but no manual tests', () => {
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
        codePaths: ['packages/@lumenflow/cli/src/wu-create-validation.ts'],
        testPathsE2e: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
        specRefs: ['lumenflow://plans/WU-9999-plan.md'],
        strict: false,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('tests.manual'))).toBe(true);
  });

  it('accepts non-doc WU with both manual and unit tests', () => {
    const result = validateCreateSpec({
      id: TEST_WU_ID,
      lane: TEST_LANE,
      title: 'Test WU',
      priority: 'P2',
      type: 'bug',
      opts: {
        description: VALID_DESCRIPTION,
        acceptance: TEST_ACCEPTANCE,
        exposure: 'backend-only',
        codePaths: ['packages/@lumenflow/cli/src/wu-create-validation.ts'],
        testPathsManual: ['Verify validation rejects empty manual tests'],
        testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
        strict: false,
      },
    });

    expect(result.valid).toBe(true);
  });

  it('skips manual test requirement for documentation WUs', () => {
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
        testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
        strict: false,
      },
    });

    expect(result.errors.some((e) => e.includes('tests.manual'))).toBe(false);
  });

  it('skips manual test requirement for process WUs', () => {
    const result = validateCreateSpec({
      id: TEST_WU_ID,
      lane: 'Operations: Process',
      title: 'Test Process WU',
      priority: 'P2',
      type: 'process',
      opts: {
        description: VALID_DESCRIPTION,
        acceptance: TEST_ACCEPTANCE,
        exposure: 'internal-only',
        strict: false,
      },
    });

    expect(result.errors.some((e) => e.includes('tests.manual'))).toBe(false);
  });

  it('error message is actionable with flag name', () => {
    const result = validateCreateSpec({
      id: TEST_WU_ID,
      lane: TEST_LANE,
      title: 'Test WU',
      priority: 'P2',
      type: 'bug',
      opts: {
        description: VALID_DESCRIPTION,
        acceptance: TEST_ACCEPTANCE,
        exposure: 'backend-only',
        codePaths: ['packages/@lumenflow/cli/src/wu-create-validation.ts'],
        testPathsUnit: ['packages/@lumenflow/cli/src/__tests__/wu-create.test.ts'],
        strict: false,
      },
    });

    const manualError = result.errors.find((e) => e.includes('tests.manual'));
    expect(manualError).toBeDefined();
    expect(manualError).toMatch(/--test-paths-manual/);
  });
});
