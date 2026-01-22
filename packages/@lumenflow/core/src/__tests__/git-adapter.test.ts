/**
 * @file git-adapter.test.ts
 * @description Tests for GitAdapter class
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';

// Hoist mock functions so they can be used in vi.mock factories
const mockRaw = vi.hoisted(() => vi.fn());

// Mock node:fs
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  rmSync: vi.fn(),
}));

// Mock simple-git
vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({
    raw: mockRaw,
  })),
}));

// Import after mocks
import { createGitForPath } from '../git-adapter.js';

describe('GitAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('worktreeRemove', () => {
    it('should remove worktree successfully when git succeeds and directory is cleaned', async () => {
      const git = createGitForPath('/test/project');
      mockRaw.mockResolvedValueOnce('');
      vi.mocked(existsSync).mockReturnValue(false);

      await git.worktreeRemove('/test/worktree');

      expect(mockRaw).toHaveBeenCalledWith(['worktree', 'remove', '/test/worktree']);
      expect(rmSync).not.toHaveBeenCalled();
    });

    it('should clean up directory when git succeeds but directory still exists', async () => {
      const git = createGitForPath('/test/project');
      mockRaw.mockResolvedValueOnce('');
      vi.mocked(existsSync).mockReturnValue(true);

      await git.worktreeRemove('/test/worktree');

      expect(rmSync).toHaveBeenCalledWith('/test/worktree', { recursive: true, force: true });
    });

    it('should use force flag when specified', async () => {
      const git = createGitForPath('/test/project');
      mockRaw.mockResolvedValueOnce('');
      vi.mocked(existsSync).mockReturnValue(false);

      await git.worktreeRemove('/test/worktree', { force: true });

      expect(mockRaw).toHaveBeenCalledWith(['worktree', 'remove', '--force', '/test/worktree']);
    });

    it('should log warning but not throw when git succeeds but rmSync fails (WU-1014)', async () => {
      const git = createGitForPath('/test/project');
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Git succeeds
      mockRaw.mockResolvedValueOnce('');
      // Directory still exists
      vi.mocked(existsSync).mockReturnValue(true);
      // rmSync throws
      vi.mocked(rmSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      // Should not throw
      await expect(git.worktreeRemove('/test/worktree')).resolves.not.toThrow();

      // Should log warning with path and error message
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('/test/worktree'));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('EACCES: permission denied'));

      warnSpy.mockRestore();
    });

    it('should throw when git fails even after cleanup attempt', async () => {
      const git = createGitForPath('/test/project');
      mockRaw.mockRejectedValueOnce(new Error('git error'));
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(rmSync).mockImplementation(() => {}); // Reset rmSync to not throw

      await expect(git.worktreeRemove('/test/worktree')).rejects.toThrow('git error');
      expect(rmSync).toHaveBeenCalled();
    });
  });

  describe('remoteBranchExists', () => {
    it('should return true when ls-remote finds a match', async () => {
      const git = createGitForPath('/test/project');
      mockRaw.mockResolvedValueOnce('abc123\trefs/heads/lane/operations/wu-123\n');

      await expect(git.remoteBranchExists('origin', 'lane/operations/wu-123')).resolves.toBe(true);
      expect(mockRaw).toHaveBeenCalledWith([
        'ls-remote',
        '--heads',
        'origin',
        'lane/operations/wu-123',
      ]);
    });

    it('should return false when ls-remote returns empty', async () => {
      const git = createGitForPath('/test/project');
      mockRaw.mockResolvedValueOnce('');

      await expect(git.remoteBranchExists('origin', 'lane/ops/wu-999')).resolves.toBe(false);
    });
  });
});
