/**
 * @file wu-done-preflight.test.ts
 * @description Tests for wu:done preflight validation helpers
 *
 * WU-1139: Wire preflight validation to CLI implementations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runPreflightTasksValidation, validateAllPreCommitHooks } from '../wu-done-preflight.js';

describe('validateAllPreCommitHooks', () => {
  let mockExecSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecSync = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('uses CLI gates command for pre-commit validation', () => {
    mockExecSync.mockReturnValue('');

    validateAllPreCommitHooks('WU-TEST', null, { execSyncFn: mockExecSync });

    expect(mockExecSync).toHaveBeenCalledWith(
      'node packages/@lumenflow/cli/dist/gates.js',
      expect.any(Object),
    );
  });

  it('uses worktree cwd when provided', () => {
    const worktreePath = '/path/to/worktree';
    mockExecSync.mockReturnValue('');

    validateAllPreCommitHooks('WU-TEST', worktreePath, { execSyncFn: mockExecSync });

    expect(mockExecSync).toHaveBeenCalledWith(
      'node packages/@lumenflow/cli/dist/gates.js',
      expect.objectContaining({ cwd: worktreePath }),
    );
  });

  describe('validation result', () => {
    it('should return valid: true when hooks pass', () => {
      mockExecSync.mockReturnValue('');

      const result = validateAllPreCommitHooks('WU-TEST', null, { execSyncFn: mockExecSync });

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it('should return valid: false with errors when hooks fail', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Hook failed');
      });

      const result = validateAllPreCommitHooks('WU-TEST', null, { execSyncFn: mockExecSync });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});

describe('runPreflightTasksValidation (WU-1139)', () => {
  let mockExecSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecSync = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('runs CLI validate command with WU_ID env', () => {
    mockExecSync.mockReturnValue('');

    runPreflightTasksValidation('WU-TEST', { execSyncFn: mockExecSync });

    expect(mockExecSync).toHaveBeenCalledWith(
      'node packages/@lumenflow/cli/dist/validate.js',
      expect.objectContaining({
        env: expect.objectContaining({ WU_ID: 'WU-TEST' }),
      }),
    );
  });

  it('returns errors when validate command fails', () => {
    mockExecSync.mockImplementation(() => {
      throw { stdout: 'ERROR [WU] Validation failed' };
    });

    const result = runPreflightTasksValidation('WU-TEST', { execSyncFn: mockExecSync });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.abortedBeforeMerge).toBe(true);
  });
});
