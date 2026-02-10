import { describe, it, expect } from 'vitest';
import { validateCreateSpec } from '../src/wu-create.js';

describe('wu:create spec validation (WU-1043)', () => {
  const baseArgs = {
    id: 'WU-9999',
    lane: 'Framework: CLI',
    title: 'Test WU',
    priority: 'P2',
    type: 'feature',
    opts: {
      description:
        'Context: test context that exceeds minimum length.\nProblem: test problem statement.\nSolution: test solution statement.',
      acceptance: ['Acceptance criterion'],
      // WU-1173: codePaths is now an array (supports repeatable pattern)
      codePaths: ['packages/@lumenflow/cli/src/wu-create.ts'],
      testPathsManual: ['Manual test: verify wu:create validation output'],
      testPathsUnit: ['packages/@lumenflow/cli/__tests__/wu-create.test.ts'],
      exposure: 'backend-only',
      specRefs: ['docs/04-operations/plans/WU-9999-plan.md'],
      // WU-1329: Disable strict validation for unit tests that use non-existent paths
      strict: false,
    },
  };

  it('rejects missing description', () => {
    const result = validateCreateSpec({
      ...baseArgs,
      opts: {
        ...baseArgs.opts,
        description: undefined,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.includes('--description'))).toBe(true);
  });

  it('rejects missing exposure', () => {
    const result = validateCreateSpec({
      ...baseArgs,
      opts: {
        ...baseArgs.opts,
        exposure: undefined,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.includes('--exposure'))).toBe(true);
  });

  it('rejects missing spec_refs for feature', () => {
    const result = validateCreateSpec({
      ...baseArgs,
      opts: {
        ...baseArgs.opts,
        specRefs: undefined,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some((err) => err.includes('--spec-refs'))).toBe(true);
  });

  it('accepts a fully specified WU', () => {
    const result = validateCreateSpec(baseArgs);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  // WU-1173: Array flags should support both repeatable and comma-separated patterns
  describe('array flag patterns (WU-1173)', () => {
    it('accepts codePaths as array (repeatable pattern)', () => {
      const result = validateCreateSpec({
        ...baseArgs,
        opts: {
          ...baseArgs.opts,
          codePaths: ['src/a.ts', 'src/b.ts'],
        },
      });

      expect(result.valid).toBe(true);
    });

    it('accepts testPathsUnit as array (repeatable pattern)', () => {
      const result = validateCreateSpec({
        ...baseArgs,
        opts: {
          ...baseArgs.opts,
          testPathsUnit: ['tests/a.test.ts', 'tests/b.test.ts'],
        },
      });

      expect(result.valid).toBe(true);
    });

    it('accepts specRefs as array (repeatable pattern)', () => {
      const result = validateCreateSpec({
        ...baseArgs,
        opts: {
          ...baseArgs.opts,
          specRefs: ['docs/plan-a.md', 'docs/plan-b.md'],
        },
      });

      expect(result.valid).toBe(true);
    });

    it('accepts multiple test path types as arrays', () => {
      const result = validateCreateSpec({
        ...baseArgs,
        opts: {
          ...baseArgs.opts,
          testPathsManual: ['Manual test 1', 'Manual test 2'],
          testPathsUnit: ['unit/a.test.ts'],
          testPathsE2e: ['e2e/a.spec.ts'],
        },
      });

      expect(result.valid).toBe(true);
    });
  });
});
