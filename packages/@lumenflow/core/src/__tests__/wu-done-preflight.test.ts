/**
 * @file wu-done-preflight.test.ts
 * @description Tests for wu:done preflight validation helpers
 *
 * WU-1139: Wire preflight validation to CLI implementations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../validators/wu-tasks.js', () => ({
  validateSingleWU: vi.fn(),
}));

vi.mock('../wu-paths.js', () => ({
  WU_PATHS: {
    WU: (id) => `/tmp/${id}.yaml`,
  },
}));

import { runPreflightTasksValidation, validateAllPreCommitHooks } from '../wu-done-preflight.js';

describe('validateAllPreCommitHooks', () => {
  let mockRunGates: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRunGates = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('invokes runGates for pre-commit validation', async () => {
    mockRunGates.mockResolvedValue(true);

    await validateAllPreCommitHooks('WU-TEST', null, { runGates: mockRunGates });

    expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ wuId: 'WU-TEST' }));
  });

  it('uses worktree cwd when provided', async () => {
    const worktreePath = '/path/to/worktree';
    mockRunGates.mockResolvedValue(true);

    await validateAllPreCommitHooks('WU-TEST', worktreePath, { runGates: mockRunGates });

    expect(mockRunGates).toHaveBeenCalledWith(expect.objectContaining({ cwd: worktreePath }));
  });

  describe('validation result', () => {
    it('should return valid: true when hooks pass', async () => {
      mockRunGates.mockResolvedValue(true);

      const result = await validateAllPreCommitHooks('WU-TEST', null, {
        runGates: mockRunGates,
      });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid: false with errors when hooks fail', async () => {
      mockRunGates.mockResolvedValue(false);

      const result = await validateAllPreCommitHooks('WU-TEST', null, {
        runGates: mockRunGates,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('runPreflightTasksValidation (WU-1139)', () => {
  it('returns valid when single WU validation passes', async () => {
    const { validateSingleWU } = await import('../validators/wu-tasks.js');
    validateSingleWU.mockReturnValue({ valid: true, warnings: [], errors: [] });

    const result = runPreflightTasksValidation('WU-TEST');

    expect(result.valid).toBe(true);
    expect(validateSingleWU).toHaveBeenCalledWith('/tmp/WU-TEST.yaml', { strict: false });
  });

  it('returns errors when single WU validation fails', async () => {
    const { validateSingleWU } = await import('../validators/wu-tasks.js');
    validateSingleWU.mockReturnValue({ valid: false, warnings: [], errors: ['bad yaml'] });

    const result = runPreflightTasksValidation('WU-TEST');

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.abortedBeforeMerge).toBe(true);
  });
});
