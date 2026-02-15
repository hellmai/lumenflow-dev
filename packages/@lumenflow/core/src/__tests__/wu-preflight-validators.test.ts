import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createPreflightResult,
  findSuggestedTestPaths,
  formatPreflightWarnings,
  validatePreflight,
} from '../wu-preflight-validators.js';
import { readWURaw } from '../wu-yaml.js';
import fg from 'fast-glob';

vi.mock('fast-glob');
vi.mock('../wu-yaml.js', () => ({
  readWURaw: vi.fn(),
}));

describe('findSuggestedTestPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('finds exact matches', async () => {
    vi.mocked(fg).mockResolvedValueOnce(['path/to/found.ts']);

    const result = await findSuggestedTestPaths(['missing.ts'], '/root');

    expect(result['missing.ts']).toContain('path/to/found.ts');
    expect(fg).toHaveBeenCalledWith('**/missing.ts', expect.objectContaining({ cwd: '/root' }));
  });

  it('finds basename with different extensions', async () => {
    vi.mocked(fg)
      .mockResolvedValueOnce([]) // Exact match
      .mockResolvedValueOnce(['path/to/found.tsx']); // Extension match

    const result = await findSuggestedTestPaths(['missing.ts'], '/root');

    expect(result['missing.ts']).toContain('path/to/found.tsx');
    expect(fg).toHaveBeenCalledWith(
      '**/missing.{ts,js,mjs,tsx,jsx}',
      expect.objectContaining({ cwd: '/root' }),
    );
  });

  it('finds code file for missing test', async () => {
    vi.mocked(fg)
      .mockResolvedValueOnce([]) // Exact match
      .mockResolvedValueOnce([]) // Extension match
      .mockResolvedValueOnce(['path/to/source.ts']); // Code match

    const result = await findSuggestedTestPaths(['missing.test.ts'], '/root');

    expect(result['missing.test.ts']).toContain('path/to/source.ts');
    expect(fg).toHaveBeenCalledWith(
      '**/missing.{ts,js,mjs,tsx,jsx}',
      expect.objectContaining({ cwd: '/root' }),
    );
  });
});

describe('formatPreflightWarnings', () => {
  it('returns consistently formatted warning lines', () => {
    const lines = formatPreflightWarnings(
      ['first warning', 'second warning'],
      '[wu-prep] ⚠️ Reality preflight warnings:',
    );

    expect(lines).toEqual([
      '[wu-prep] ⚠️ Reality preflight warnings:',
      '  - first warning',
      '  - second warning',
    ]);
  });
});

describe('createPreflightResult', () => {
  it('returns typed defaults for optional arrays and maps', () => {
    const result = createPreflightResult({ valid: true });

    expect(result).toEqual({
      valid: true,
      errors: [],
      warnings: [],
      missingCodePaths: [],
      missingCoverageCodePaths: [],
      missingTestPaths: [],
      changedFiles: [],
      suggestedTestPaths: {},
    });
  });
});

describe('validatePreflight', () => {
  it('handles non-Error throw values from readWURaw', async () => {
    vi.mocked(readWURaw).mockImplementationOnce(() => {
      throw 'read failure';
    });

    const result = await validatePreflight('WU-9999', { worktreePath: '/tmp' });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Failed to read WU YAML: read failure']);
  });
});
