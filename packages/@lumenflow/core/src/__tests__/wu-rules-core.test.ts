import { describe, expect, it } from 'vitest';
import {
  RULE_CODES,
  validateWURulesSync,
  validateWURulesWithResolvers,
  type WURuleResolvers,
} from '../wu-rules-core.js';

function createResolvers(overrides: Partial<WURuleResolvers> = {}): WURuleResolvers {
  return {
    pathReferenceExists: async () => true,
    resolveChangedFiles: async () => ({
      ok: true,
      files: ['packages/@lumenflow/cli/package.json'],
      baseRef: 'main',
      headRef: 'HEAD',
    }),
    resolveCliBinDiff: async () => ({
      state: 'changed',
      baseRef: 'main',
      headRef: 'HEAD',
    }),
    ...overrides,
  };
}

describe('wu-rules-core', () => {
  it('uses injected resolvers for reality-phase parity decisions', async () => {
    const result = await validateWURulesWithResolvers(
      {
        id: 'WU-3001',
        type: 'refactor',
        code_paths: ['packages/@lumenflow/cli/package.json'],
        tests: { manual: ['verify metadata update'] },
      },
      { phase: 'reality' },
      createResolvers(),
    );

    const parityIssues = result.errors.filter((issue) => issue.code === RULE_CODES.PARITY_MISSING_SURFACE);
    expect(parityIssues).toHaveLength(2);
  });

  it('fails closed when injected diff resolver is unavailable', async () => {
    const result = await validateWURulesWithResolvers(
      {
        id: 'WU-3002',
        type: 'refactor',
        code_paths: ['packages/@lumenflow/cli/src/wu-prep.ts'],
        tests: { manual: ['manual validation'] },
      },
      { phase: 'reality' },
      createResolvers({
        resolveChangedFiles: async () => ({ ok: false, reason: 'base ref unavailable' }),
      }),
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === RULE_CODES.CODE_PATH_COVERAGE)).toBe(true);
  });

  it('keeps intent-phase validation pure and synchronous', () => {
    const result = validateWURulesSync(
      {
        id: 'WU-3003',
        type: 'refactor',
        code_paths: ['packages/@lumenflow/cli/src/wu-prep.ts'],
        tests: { manual: [] },
      },
      { phase: 'intent' },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.some((issue) => issue.code === RULE_CODES.MINIMUM_TEST_INTENT)).toBe(true);
  });
});
