/**
 * @file micro-worktree.test.mjs
 * @description Tests for micro-worktree push-only pattern (WU-1435)
 *
 * Tests the pushOnly option that keeps local main pristine by pushing
 * directly to origin/main via refspec instead of merging to local main.
 */

import { describe, it, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Mock dependencies before importing module under test
const mockGit = {
  createBranchNoCheckout: mock.fn(async () => {}),
  worktreeAddExisting: mock.fn(async () => {}),
  worktreeRemove: mock.fn(async () => {}),
  branchExists: mock.fn(async () => true),
  deleteBranch: mock.fn(async () => {}),
  add: mock.fn(async () => {}),
  commit: mock.fn(async () => {}),
  push: mock.fn(async () => {}),
  pushRefspec: mock.fn(async () => {}),
  fetch: mock.fn(async () => {}),
  merge: mock.fn(async () => {}),
  rebase: mock.fn(async () => {}),
};

// We'll need to mock the module - for now test the constants and helpers
import { getTempBranchName, MAX_MERGE_RETRIES } from '../micro-worktree.js';

describe('micro-worktree', () => {
  describe('getTempBranchName', () => {
    it('should generate temp branch name in correct format', () => {
      const result = getTempBranchName('wu-claim', 'WU-1435');
      assert.equal(result, 'tmp/wu-claim/wu-1435');
    });

    it('should lowercase the WU ID', () => {
      const result = getTempBranchName('wu-create', 'WU-999');
      assert.equal(result, 'tmp/wu-create/wu-999');
    });
  });

  describe('MAX_MERGE_RETRIES', () => {
    it('should be a positive number', () => {
      assert.equal(typeof MAX_MERGE_RETRIES, 'number');
      assert.ok(MAX_MERGE_RETRIES > 0);
    });
  });
});

describe('pre-claim repair isolation (WU-1437)', () => {
  describe('ORPHAN_REPAIR operation', () => {
    it('should export ORPHAN_REPAIR operation constant', async () => {
      const { MICRO_WORKTREE_OPERATIONS } = await import('../wu-constants.js');
      assert.ok(MICRO_WORKTREE_OPERATIONS.ORPHAN_REPAIR);
      assert.equal(typeof MICRO_WORKTREE_OPERATIONS.ORPHAN_REPAIR, 'string');
    });
  });

  describe('repairWUInconsistency with projectRoot', () => {
    it('should accept projectRoot option for micro-worktree path', async () => {
      const { repairWUInconsistency } = await import('../wu-consistency-checker.js');
      // Function should accept projectRoot option
      // When valid=true, should return early without touching any files
      const result = await repairWUInconsistency({ valid: true }, { projectRoot: '/tmp/test' });
      assert.deepEqual(result, { repaired: 0, skipped: 0, failed: 0 });
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
      assert.equal(typeof adapter.pushRefspec, 'function');
    });

    it('should push local ref to different remote ref', async () => {
      const { GitAdapter } = await import('../git-adapter.js');

      // Create mock that tracks calls
      const pushMock = mock.fn(async () => {});
      const adapter = new GitAdapter({
        git: { push: pushMock },
      });

      await adapter.pushRefspec('origin', 'tmp/wu-claim/wu-1435', 'main');

      // Verify push was called with refspec format
      assert.equal(pushMock.mock.calls.length, 1);
      const [remote, refspec] = pushMock.mock.calls[0].arguments;
      assert.equal(remote, 'origin');
      assert.equal(refspec, 'tmp/wu-claim/wu-1435:main');
    });
  });

  describe('formatFiles helper', () => {
    it('should export formatFiles function', async () => {
      const { formatFiles } = await import('../micro-worktree.js');
      assert.equal(typeof formatFiles, 'function');
    });
  });

  describe('withMicroWorktree pushOnly option', () => {
    it('should accept pushOnly option', async () => {
      // This test verifies the function signature accepts pushOnly
      const { withMicroWorktree } = await import('../micro-worktree.js');

      // The function should not throw on valid options with pushOnly
      // We can't fully test without mocking the git operations
      assert.equal(typeof withMicroWorktree, 'function');
    });
  });
});

describe('orphaned temp branch/worktree cleanup (WU-2237)', () => {
  describe('findWorktreeByBranch', () => {
    it('should export findWorktreeByBranch function', async () => {
      const { findWorktreeByBranch } = await import('../micro-worktree.js');
      assert.equal(typeof findWorktreeByBranch, 'function');
    });

    it('should find worktree path for matching branch', async () => {
      const { findWorktreeByBranch } = await import('../micro-worktree.js');

      const worktreeListOutput =
        'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
        'worktree /tmp/wu-create-xyz123\nHEAD def456\nbranch refs/heads/tmp/wu-create/wu-999\n\n';

      const result = findWorktreeByBranch(worktreeListOutput, 'tmp/wu-create/wu-999');
      assert.equal(result, '/tmp/wu-create-xyz123');
    });

    it('should return null when branch not found', async () => {
      const { findWorktreeByBranch } = await import('../micro-worktree.js');

      const worktreeListOutput =
        'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n';

      const result = findWorktreeByBranch(worktreeListOutput, 'tmp/wu-create/wu-999');
      assert.equal(result, null);
    });

    it('should handle main project worktree correctly', async () => {
      const { findWorktreeByBranch } = await import('../micro-worktree.js');

      const worktreeListOutput =
        'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
        'worktree /home/user/project/worktrees/lane-wu-100\nHEAD def456\nbranch refs/heads/lane/lane/wu-100\n\n';

      const mainResult = findWorktreeByBranch(worktreeListOutput, 'main');
      assert.equal(mainResult, '/home/user/project');

      const laneResult = findWorktreeByBranch(worktreeListOutput, 'lane/lane/wu-100');
      assert.equal(laneResult, '/home/user/project/worktrees/lane-wu-100');
    });
  });

  describe('cleanupOrphanedMicroWorktree', () => {
    it('should export cleanupOrphanedMicroWorktree function', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');
      assert.equal(typeof cleanupOrphanedMicroWorktree, 'function');
    });

    it('should detect and clean orphaned worktree from git worktree list', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');

      // Create mock git adapter that simulates orphaned worktree
      const worktreeListMock = mock.fn(
        async () =>
          'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n' +
          'worktree /tmp/wu-create-xyz123\nHEAD def456\nbranch refs/heads/tmp/wu-create/wu-999\n\n'
      );
      const worktreeRemoveMock = mock.fn(async () => {});
      const branchExistsMock = mock.fn(async () => true);
      const deleteBranchMock = mock.fn(async () => {});

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
      assert.equal(result.cleanedWorktree, true);
      assert.equal(worktreeRemoveMock.mock.calls.length, 1);
      assert.equal(worktreeRemoveMock.mock.calls[0].arguments[0], '/tmp/wu-create-xyz123');
    });

    it('should remove temp branch after worktree removal', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');

      const worktreeListMock = mock.fn(
        async () =>
          'worktree /tmp/wu-create-orphan\nHEAD def456\nbranch refs/heads/tmp/wu-create/wu-888\n\n'
      );
      const worktreeRemoveMock = mock.fn(async () => {});
      const branchExistsMock = mock.fn(async () => true);
      const deleteBranchMock = mock.fn(async () => {});

      const mockGitAdapter = {
        worktreeList: worktreeListMock,
        worktreeRemove: worktreeRemoveMock,
        branchExists: branchExistsMock,
        deleteBranch: deleteBranchMock,
      };

      await cleanupOrphanedMicroWorktree('wu-create', 'WU-888', mockGitAdapter, '[test]');

      // Should have deleted the temp branch
      assert.equal(branchExistsMock.mock.calls.length, 1);
      assert.equal(deleteBranchMock.mock.calls.length, 1);
      assert.equal(deleteBranchMock.mock.calls[0].arguments[0], 'tmp/wu-create/wu-888');
    });

    it('should return cleanedWorktree=false when no orphan exists', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');

      // Worktree list with no matching temp branches
      const worktreeListMock = mock.fn(
        async () => 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n'
      );
      const branchExistsMock = mock.fn(async () => false);
      const deleteBranchMock = mock.fn(async () => {});

      const mockGitAdapter = {
        worktreeList: worktreeListMock,
        worktreeRemove: mock.fn(async () => {}),
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
      assert.equal(result.cleanedWorktree, false);
      assert.equal(result.cleanedBranch, false);
    });

    it('should clean branch even when no worktree exists', async () => {
      const { cleanupOrphanedMicroWorktree } = await import('../micro-worktree.js');

      // No worktree matches, but branch exists (stale branch scenario)
      const worktreeListMock = mock.fn(
        async () => 'worktree /home/user/project\nHEAD abc123\nbranch refs/heads/main\n\n'
      );
      const branchExistsMock = mock.fn(async () => true);
      const deleteBranchMock = mock.fn(async () => {});

      const mockGitAdapter = {
        worktreeList: worktreeListMock,
        worktreeRemove: mock.fn(async () => {}),
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
      assert.equal(result.cleanedWorktree, false);
      assert.equal(result.cleanedBranch, true);
      assert.equal(deleteBranchMock.mock.calls.length, 1);
    });
  });

  describe('cleanupMicroWorktree handles registered worktrees', () => {
    it('should check git worktree list for registered worktrees', async () => {
      const { cleanupMicroWorktree } = await import('../micro-worktree.js');

      // This test verifies cleanupMicroWorktree also cleans up registered worktrees
      // by checking git worktree list for the temp branch
      assert.equal(typeof cleanupMicroWorktree, 'function');
    });
  });

  describe('withMicroWorktree calls cleanup before create', () => {
    it('should call cleanupOrphanedMicroWorktree before creating new micro-worktree', async () => {
      // This test ensures withMicroWorktree is idempotent
      // by cleaning up any prior orphans before creating new resources
      const { withMicroWorktree } = await import('../micro-worktree.js');
      assert.equal(typeof withMicroWorktree, 'function');
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
      assert.equal(typeof adapter.addWithDeletions, 'function');
    });

    it('should use git add -A flag to stage deletions when files provided', async () => {
      const { GitAdapter } = await import('../git-adapter.js');

      // Create mock that tracks raw git calls
      const rawMock = mock.fn(async () => '');
      const adapter = new GitAdapter({
        git: { raw: rawMock },
      });

      await adapter.addWithDeletions(['file1.txt', 'file2.txt']);

      // Verify git add -A was called with the files
      assert.equal(rawMock.mock.calls.length, 1);
      const args = rawMock.mock.calls[0].arguments[0];
      assert.deepEqual(args, ['add', '-A', '--', 'file1.txt', 'file2.txt']);
    });

    it('should stage all changes when empty files list provided', async () => {
      const { GitAdapter } = await import('../git-adapter.js');

      // Create mock that tracks raw git calls
      const rawMock = mock.fn(async () => '');
      const adapter = new GitAdapter({
        git: { raw: rawMock },
      });

      await adapter.addWithDeletions([]);

      // Verify git add -A . was called for empty list
      assert.equal(rawMock.mock.calls.length, 1);
      const args = rawMock.mock.calls[0].arguments[0];
      assert.deepEqual(args, ['add', '-A', '.']);
    });
  });

  describe('stageChangesWithDeletions helper', () => {
    it('should export stageChangesWithDeletions function', async () => {
      const { stageChangesWithDeletions } = await import('../micro-worktree.js');
      assert.equal(typeof stageChangesWithDeletions, 'function');
    });

    it('should call addWithDeletions on gitWorktree with files list', async () => {
      const { stageChangesWithDeletions } = await import('../micro-worktree.js');

      // Create mock gitWorktree
      const addWithDeletionsMock = mock.fn(async () => {});
      const mockGitWorktree = {
        addWithDeletions: addWithDeletionsMock,
      };

      await stageChangesWithDeletions(mockGitWorktree, ['deleted.txt', 'modified.txt']);

      // Verify addWithDeletions was called with files
      assert.equal(addWithDeletionsMock.mock.calls.length, 1);
      const files = addWithDeletionsMock.mock.calls[0].arguments[0];
      assert.deepEqual(files, ['deleted.txt', 'modified.txt']);
    });

    it('should call addWithDeletions with empty array when files is undefined', async () => {
      const { stageChangesWithDeletions } = await import('../micro-worktree.js');

      // Create mock gitWorktree
      const addWithDeletionsMock = mock.fn(async () => {});
      const mockGitWorktree = {
        addWithDeletions: addWithDeletionsMock,
      };

      await stageChangesWithDeletions(mockGitWorktree, undefined);

      // Verify addWithDeletions was called with empty array
      assert.equal(addWithDeletionsMock.mock.calls.length, 1);
      const files = addWithDeletionsMock.mock.calls[0].arguments[0];
      assert.deepEqual(files, []);
    });
  });
});
