/**
 * @file wu-done-preflight.test.ts
 * @description Tests for wu:done preflight validation helpers
 *
 * WU-1086: Fix gates-pre-commit module resolution to support .mjs extension
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock node:fs for existsSync
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { validateAllPreCommitHooks } from '../wu-done-preflight.js';

describe('validateAllPreCommitHooks', () => {
  let mockExecSync: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockExecSync = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('WU-1086: gate script extension resolution', () => {
    it('should try .mjs extension first when it exists', () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.toString().endsWith('gates-pre-commit.mjs');
      });
      mockExecSync.mockReturnValue('');

      validateAllPreCommitHooks('WU-TEST', null, { execSyncFn: mockExecSync });

      expect(mockExecSync).toHaveBeenCalledWith(
        'node tools/gates-pre-commit.mjs',
        expect.any(Object),
      );
    });

    it('should fall back to .js extension when .mjs does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);
      mockExecSync.mockReturnValue('');

      validateAllPreCommitHooks('WU-TEST', null, { execSyncFn: mockExecSync });

      expect(mockExecSync).toHaveBeenCalledWith(
        'node tools/gates-pre-commit.js',
        expect.any(Object),
      );
    });

    it('should check .mjs in worktree path when provided', () => {
      const worktreePath = '/path/to/worktree';
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.toString() === `${worktreePath}/tools/gates-pre-commit.mjs`;
      });
      mockExecSync.mockReturnValue('');

      validateAllPreCommitHooks('WU-TEST', worktreePath, { execSyncFn: mockExecSync });

      expect(existsSync).toHaveBeenCalledWith(`${worktreePath}/tools/gates-pre-commit.mjs`);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node tools/gates-pre-commit.mjs',
        expect.objectContaining({ cwd: worktreePath }),
      );
    });

    it('should check .mjs in current directory when no worktree provided', () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.toString() === './tools/gates-pre-commit.mjs';
      });
      mockExecSync.mockReturnValue('');

      validateAllPreCommitHooks('WU-TEST', null, { execSyncFn: mockExecSync });

      expect(existsSync).toHaveBeenCalledWith('./tools/gates-pre-commit.mjs');
    });
  });

  describe('validation result', () => {
    beforeEach(() => {
      vi.mocked(existsSync).mockReturnValue(false);
    });

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
