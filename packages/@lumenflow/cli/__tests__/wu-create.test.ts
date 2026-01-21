import { describe, it, expect } from 'vitest';
import { validateCreateSpec } from '../dist/wu-create.js';

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
      codePaths: 'packages/@lumenflow/cli/src/wu-create.ts',
      testPathsUnit: 'packages/@lumenflow/cli/__tests__/wu-create.test.ts',
      exposure: 'backend-only',
      specRefs: 'docs/04-operations/plans/WU-9999-plan.md',
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
});
