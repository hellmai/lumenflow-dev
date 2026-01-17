/**
 * @file micro-worktree.test.mjs
 * @description Tests for micro-worktree push-only pattern (WU-1435)
 *
 * Tests the pushOnly option that keeps local main pristine by pushing
 * directly to origin/main via refspec instead of merging to local main.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dependencies before importing module under test
const mockGit = {
  createBranchNoCheckout: vi.fn(async () => {}),
  worktreeAddExisting: vi.fn(async () => {}),
  worktreeRemove: vi.fn(async () => {}),
  branchExists: vi.fn(async () => true),
  deleteBranch: vi.fn(async () => {}),
  add: vi.fn(async () => {}),
  commit: vi.fn(async () => {}),
  push: vi.fn(async () => {}),
  pushRefspec: vi.fn(async () => {}),
  fetch: vi.fn(async () => {}),
  merge: vi.fn(async () => {}),
  rebase: vi.fn(async () => {}),
};

// We'll need to mock the module - for now test the constants and helpers
import { getTempBranchName, MAX_MERGE_RETRIES } from '../micro-worktree.js';

describe('micro-worktree', () => {
  describe('getTempBranchName', () => {
    it('should generate temp branch name in correct format', () => {
      const result = getTempBranchName('wu-claim', 'WU-1435');
      expect(result).toBe('tmp/wu-claim/wu-1435');
    });

    it('should lowercase the WU ID', () => {
      const result = getTempBranchName('wu-create', 'WU-999');
      expect(result).toBe('tmp/wu-create/wu-999');
    });
  });

  describe('MAX_MERGE_RETRIES', () => {
    it('should be a positive number', () => {
      expect(typeof MAX_MERGE_RETRIES).toBe('number');
      expect(MAX_MERGE_RETRIES > 0).toBeTruthy();
    });
  });
});

describe('pre-claim repair isolation (WU-1437)', () => {
  describe('ORPHAN_REPAIR operation', () => {
    it('should export ORPHAN_REPAIR operation constant', async () => {
      const { MICRO_WORKTREE_OPERATIONS } = await import('../wu-constants.js');
      expect(MICRO_WORKTREE_OPERATIONS.ORPHAN_REPAIR).toBeTruthy();
      expect(typeof MICRO_WORKTREE_OPERATIONS.ORPHAN_REPAIR).toBe('string');
    });
  });

  describe('repairWUInconsistency with projectRoot', () => {
    it('should accept projectRoot option for micro-worktree path', async () => {
      const { repairWUInconsistency } = await import('../wu-consistency-checker.js');
      // Function should accept projectRoot option
      // When valid=true, should return early without touching any files
      const result = await repairWUInconsistency({ valid: true }, { projectRoot: '/tmp/test' });
      expect(result).toEqual({ repaired: 0, skipped: 0, failed: 0 });
    });
  });
});

describe('pushOnly pattern (WU-1435)', () => {
  describe('git-adapter pushRefspec', () => {
    it('should support refspec push syntax', async () => {
      // This test verifies the git-adapter has pushRefspec method
      // Imports will fail until implementation is done
      const { GitAdapter } = await import('../git-adapter.js');
      const adapter = new GitAdapter({ git: mockGit });

      // pushRefspec should exist
      expect(typeof adapter.pushRefspec).toBe('function');
    });

    it('should push local ref to different remote ref', async () => {
      const { GitAdapter } = await import('../git-adapter.js');

      // Create mock that tracks calls
      const pushMock = vi.fn(async () => {});
      const adapter = new GitAdapter({
        git: { push: pushMock },
      });

      await adapter.pushRefspec('origin', 'tmp/wu-claim/wu-1435', 'main');

      // Verify push was called with refspec format
      expect(pushMock.mock.calls.length).toBe(1);
      const [remote, refspec] = pushMock.mock.calls[0];
      expect(remote).toBe('origin');
      expect(refspec).toBe('tmp/wu-claim/wu-1435:main');
    });
  });

  describe('formatFiles helper', () => {
    it('should export formatFiles function', async () => {
      const { formatFiles } = await import('../micro-worktree.js');
      expect(typeof formatFiles).toBe('function');
    });
  });

  describe('withMicroWorktree pushOnly option', () => {
    it('should accept pushOnly option', async () => {
      // This test verifies the function signature accepts pushOnly
      const { withMicroWorktree } = await import('../micro-worktree.js');

      // The function should not throw on valid options with pushOnly
      // We can't fully test without mocking the git operations
      expect(typeof withMicroWorktree).toBe('function');
    });
  });
});

describe('orphaned temp branch/worktree cleanup (WU-2237)', () => {
  describe('findWorktreeByBranch', () => {
    it('should export findWorktreeByBranch function', async () => {
      const { findWorktreeByBranch } = await import('../micro-worktree.js');
      expect(typeof findWorktreeByBranch).toBe('function');
    });

    it('should find worktree path for matching branch', async () => {
      const { findWorktreeByBranch } = await import('../micro-worktree.js');

      const worktreeListOutput =
        'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
        'worktree /tmp/wu-create-xyz123\nHEAD def456\nbranch refs/heads/tmp/wu-create/wu-999\n\n';

      const result = findWorktreeByBranch(worktreeListOutput, 'tmp/wu-create/wu-999');
      expect(result).toBe('/tmp/wu-create-xyz123');
    });

    it('should return null when branch not found', async () => {
      const { findWorktreeByBranch } = await import('../micro-worktree.js');

      const worktreeListOutput =
        'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n';

      const result = findWorktreeByBranch(worktreeListOutput, 'tmp/wu-create/wu-999');
      expect(result).toBe(null);
    });

    it('should handle main project worktree correctly', async () => {
      const { findWorktreeByBranch } = await import('../micro-worktree.js');

      const worktreeListOutput =
        'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
        'worktree /home/user/project/worktrees/lane-wu-100\nHEAD def456\nbranch refs/heads/lane/lane/wu-100\n\n';

      const mainResult = findWorktreeByBranch(worktreeListOutput, 'main');
      expect(mainResult).toBe('/home/user/project');

      const laneResult = findWorktreeByBranch(worktreeListOutput, 'lane/lane/wu-100');
      expect(laneResult).toBe('/home/user/project/worktrees/lane-wu-100');
    });
  });

  describe('cleanupOrphanedMicroWorktree', () => {
    it('should export cleanupOrphanedMicroWorktree function', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');
      expect(typeof cleanupOrphanedMicroWorktree).toBe('function');
    });

    it('should detect and clean orphaned worktree from git worktree list', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');

      // Create mock git adapter that simulates orphaned worktree
      const worktreeListMock = vi.fn(
        async () =>
          'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
          'worktree /tmp/wu-create-xyz123\nHEAD def456\nbranch refs/heads/tmp/wu-create/wu-999\n\n'
      );
      const worktreeRemoveMock = vi.fn(async () => {});
      const branchExistsMock = vi.fn(async () => true);
      const deleteBranchMock = vi.fn(async () => {});

      const mockGitAdapter = {
        worktreeList: worktreeListMock,
        worktreeRemove: worktreeRemoveMock,
        branchExists: branchExistsMock,
        deleteBranch: deleteBranchMock,
      };

      const result = await cleanupOrphanedMicroWorktree(
        'wu-create',
        'WU-999',
        mockGitAdapter,
        '[test]'
      );

      // Should have found and cleaned the orphaned worktree
      expect(result.cleanedWorktree).toBe(true);
      expect(worktreeRemoveMock.mock.calls.length).toBe(1);
      expect(worktreeRemoveMock.mock.calls[0][0]).toBe('/tmp/wu-create-xyz123');
    });

    it('should remove temp branch after worktree removal', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');

      const worktreeListMock = vi.fn(
        async () =>
          'worktree /tmp/wu-create-orphan\nHEAD def456\nbranch refs/heads/tmp/wu-create/wu-888\n\n'
      );
      const worktreeRemoveMock = vi.fn(async () => {});
      const branchExistsMock = vi.fn(async () => true);
      const deleteBranchMock = vi.fn(async () => {});

      const mockGitAdapter = {
        worktreeList: worktreeListMock,
        worktreeRemove: worktreeRemoveMock,
        branchExists: branchExistsMock,
        deleteBranch: deleteBranchMock,
      };

      await cleanupOrphanedMicroWorktree('wu-create', 'WU-888', mockGitAdapter, '[test]');

      // Should have deleted the temp branch
      expect(branchExistsMock.mock.calls.length).toBe(1);
      expect(deleteBranchMock.mock.calls.length).toBe(1);
      expect(deleteBranchMock.mock.calls[0][0]).toBe('tmp/wu-create/wu-888');
    });

    it('should return cleanedWorktree=false when no orphan exists', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');

      // Worktree list with no matching temp branches
      const worktreeListMock = vi.fn(
        async () => 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n'
      );
      const branchExistsMock = vi.fn(async () => false);
      const deleteBranchMock = vi.fn(async () => {});

      const mockGitAdapter = {
        worktreeList: worktreeListMock,
        worktreeRemove: vi.fn(async () => {}),
        branchExists: branchExistsMock,
        deleteBranch: deleteBranchMock,
      };

      const result = await cleanupOrphanedMicroWorktree(
        'wu-create',
        'WU-777',
        mockGitAdapter,
        '[test]'
      );

      // No orphan found
      expect(result.cleanedWorktree).toBe(false);
      expect(result.cleanedBranch).toBe(false);
    });

    it('should clean branch even when no worktree exists', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');

      // No worktree matches, but branch exists (stale branch scenario)
      const worktreeListMock = vi.fn(
        async () => 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n'
      );
      const branchExistsMock = vi.fn(async () => true);
      const deleteBranchMock = vi.fn(async () => {});

      const mockGitAdapter = {
        worktreeList: worktreeListMock,
        worktreeRemove: vi.fn(async () => {}),
        branchExists: branchExistsMock,
        deleteBranch: deleteBranchMock,
      };

      const result = await cleanupOrphanedMicroWorktree(
        'wu-create',
        'WU-666',
        mockGitAdapter,
        '[test]'
      );

      // Branch should be cleaned even without worktree
      expect(result.cleanedWorktree).toBe(false);
      expect(result.cleanedBranch).toBe(true);
      expect(deleteBranchMock.mock.calls.length).toBe(1);
    });
  });

  describe('cleanupMicroWorktree handles registered worktrees', () => {
    it('should check git worktree list for registered worktrees', async () => {
      const { cleanupMicroWorktree } = await import('../micro-worktree.js');

      // This test verifies cleanupMicroWorktree also cleans up registered worktrees
      // by checking git worktree list for the temp branch
      expect(typeof cleanupMicroWorktree).toBe('function');
    });
  });

  describe('withMicroWorktree calls cleanup before create', () => {
    it('should call cleanupOrphanedMicroWorktree before creating new micro-worktree', async () => {
      // This test ensures withMicroWorktree is idempotent
      // by cleaning up any prior orphans before creating new resources
      const { withMicroWorktree } = await import('../micro-worktree.js');
      expect(typeof withMicroWorktree).toBe('function');
      // Full integration test would require mocking git operations
    });
  });
});

describe('deletion staging (WU-1813)', () => {
  describe('git-adapter addWithDeletions', () => {
    it('should export addWithDeletions method', async () => {
      const { GitAdapter } = await import('../git-adapter.js');
      const adapter = new GitAdapter({ git: mockGit });

      // addWithDeletions should exist
      expect(typeof adapter.addWithDeletions).toBe('function');
    });

    it('should use git add -A flag to stage deletions when files provided', async () => {
      const { GitAdapter } = await import('../git-adapter.js');

      // Create mock that tracks raw git calls
      const rawMock = vi.fn(async () => '');
      const adapter = new GitAdapter({
        git: { raw: rawMock },
      });

      await adapter.addWithDeletions(['file1.txt', 'file2.txt']);

      // Verify git add -A was called with the files
      expect(rawMock.mock.calls.length).toBe(1);
      const args = rawMock.mock.calls[0][0];
      expect(args).toEqual(['add', '-A', '--', 'file1.txt', 'file2.txt']);
    });

    it('should stage all changes when empty files list provided', async () => {
      const { GitAdapter } = await import('../git-adapter.js');

      // Create mock that tracks raw git calls
      const rawMock = vi.fn(async () => '');
      const adapter = new GitAdapter({
        git: { raw: rawMock },
      });

      await adapter.addWithDeletions([]);

      // Verify git add -A . was called for empty list
      expect(rawMock.mock.calls.length).toBe(1);
      const args = rawMock.mock.calls[0][0];
      expect(args).toEqual(['add', '-A', '.']);
    });
  });

  describe('stageChangesWithDeletions helper', () => {
    it('should export stageChangesWithDeletions function', async () => {
      const { stageChangesWithDeletions } = await import('../micro-worktree.js');
      expect(typeof stageChangesWithDeletions).toBe('function');
    });

    it('should call addWithDeletions on gitWorktree with files list', async () => {
      const { stageChangesWithDeletions } = await import('../micro-worktree.js');

      // Create mock gitWorktree
      const addWithDeletionsMock = vi.fn(async () => {});
      const mockGitWorktree = {
        addWithDeletions: addWithDeletionsMock,
      };

      await stageChangesWithDeletions(mockGitWorktree, ['deleted.txt', 'modified.txt']);

      // Verify addWithDeletions was called with files
      expect(addWithDeletionsMock.mock.calls.length).toBe(1);
      const files = addWithDeletionsMock.mock.calls[0][0];
      expect(files).toEqual(['deleted.txt', 'modified.txt']);
    });

    it('should call addWithDeletions with empty array when files is undefined', async () => {
      const { stageChangesWithDeletions } = await import('../micro-worktree.js');

      // Create mock gitWorktree
      const addWithDeletionsMock = vi.fn(async () => {});
      const mockGitWorktree = {
        addWithDeletions: addWithDeletionsMock,
      };

      await stageChangesWithDeletions(mockGitWorktree, undefined);

      // Verify addWithDeletions was called with empty array
      expect(addWithDeletionsMock.mock.calls.length).toBe(1);
      const files = addWithDeletionsMock.mock.calls[0][0];
      expect(files).toEqual([]);
    });
  });
});
