import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as gitAdapter from '@lumenflow/core/git-adapter';
import { GIT_FLAGS, REMOTES } from '@lumenflow/core/wu-constants';
import { deleteLaneBranchArtifacts, getLaneBranchNameForWU } from '../wu-recover.js';

vi.mock('@lumenflow/core/git-adapter');

describe('wu-recover helpers', () => {
  const mockGit = {
    deleteBranch: vi.fn(),
    raw: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(gitAdapter.getGitForCwd).mockReturnValue(mockGit as any);
    mockGit.deleteBranch.mockResolvedValue(undefined);
    mockGit.raw.mockResolvedValue('');
  });

  describe('getLaneBranchNameForWU', () => {
    it('uses canonical lane branch naming', () => {
      expect(getLaneBranchNameForWU('WU-1624', 'Framework: Core State Recovery')).toBe(
        'lane/framework-core-state-recovery/wu-1624',
      );
    });
  });

  describe('deleteLaneBranchArtifacts', () => {
    it('deletes local and remote branch artifacts', async () => {
      await deleteLaneBranchArtifacts('WU-1624', 'Framework: Core State Recovery');

      expect(mockGit.deleteBranch).toHaveBeenCalledWith(
        'lane/framework-core-state-recovery/wu-1624',
        { force: true },
      );
      expect(mockGit.raw).toHaveBeenCalledWith([
        'push',
        REMOTES.ORIGIN,
        GIT_FLAGS.DELETE_REMOTE,
        'lane/framework-core-state-recovery/wu-1624',
      ]);
    });

    it('is a no-op when lane is empty', async () => {
      await deleteLaneBranchArtifacts('WU-1624', '');

      expect(gitAdapter.getGitForCwd).not.toHaveBeenCalled();
      expect(mockGit.deleteBranch).not.toHaveBeenCalled();
      expect(mockGit.raw).not.toHaveBeenCalled();
    });
  });
});
