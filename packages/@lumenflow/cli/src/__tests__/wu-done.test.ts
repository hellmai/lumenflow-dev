import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureCleanWorktree } from '../wu-done-check.js';
import * as gitAdapter from '@lumenflow/core/git-adapter';
import * as errorHandler from '@lumenflow/core/error-handler';

// Mock dependencies
vi.mock('@lumenflow/core/git-adapter');
vi.mock('@lumenflow/core/error-handler');

describe('wu-done', () => {
  describe('ensureCleanWorktree', () => {
    let mockGit: any;

    beforeEach(() => {
      vi.resetAllMocks();
      mockGit = {
        getStatus: vi.fn(),
      };
      vi.mocked(gitAdapter.createGitForPath).mockReturnValue(mockGit);
    });

    it('should pass if worktree is clean', async () => {
      mockGit.getStatus.mockResolvedValue(''); // Clean status

      await ensureCleanWorktree('/path/to/worktree');

      expect(mockGit.getStatus).toHaveBeenCalled();
      expect(errorHandler.die).not.toHaveBeenCalled();
    });

    it('should die if worktree has uncommitted changes', async () => {
      mockGit.getStatus.mockResolvedValue('M  file.ts\n?? new-file.ts'); // Dirty status

      await ensureCleanWorktree('/path/to/worktree');

      expect(mockGit.getStatus).toHaveBeenCalled();
      expect(errorHandler.die).toHaveBeenCalledWith(
        expect.stringContaining('Worktree has uncommitted changes'),
      );
    });

    it('should use the correct worktree path', async () => {
      mockGit.getStatus.mockResolvedValue('');

      await ensureCleanWorktree('/custom/worktree/path');

      expect(gitAdapter.createGitForPath).toHaveBeenCalledWith('/custom/worktree/path');
    });
  });
});
