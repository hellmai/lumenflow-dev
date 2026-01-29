/**
 * Tests for micro-worktree operations
 *
 * WU-1081: Tests for LUMENFLOW_FORCE environment variable handling
 * during push-only mode in withMicroWorktree.
 *
 * WU-1179: Tests for push race condition handling (fetch before start,
 * rollback + retry on push failure).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We need to test that pushRefspecWithForce sets LUMENFLOW_FORCE
// This is the function we're adding in WU-1081

describe('micro-worktree', () => {
  describe('pushRefspecWithForce', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      // Clear any existing LUMENFLOW_FORCE values
      delete process.env.LUMENFLOW_FORCE;
      delete process.env.LUMENFLOW_FORCE_REASON;
    });

    afterEach(() => {
      // Restore original environment
      process.env = { ...originalEnv };
    });

    it('should set LUMENFLOW_FORCE=1 during push', async () => {
      // This test will fail until we implement pushRefspecWithForce
      const { pushRefspecWithForce } = await import('../micro-worktree.js');

      // Track what env vars were set during the push
      let envDuringPush: { force?: string; reason?: string } = {};

      // Mock git adapter
      const mockGitAdapter = {
        pushRefspec: vi.fn().mockImplementation(async () => {
          // Capture env during execution
          envDuringPush = {
            force: process.env.LUMENFLOW_FORCE,
            reason: process.env.LUMENFLOW_FORCE_REASON,
          };
        }),
      };

      await pushRefspecWithForce(
        mockGitAdapter as never,
        'origin',
        'tmp/wu-claim/wu-123',
        'main',
        'micro-worktree push for wu:claim (automated)',
      );

      // Verify LUMENFLOW_FORCE was set to '1' during the push
      expect(envDuringPush.force).toBe('1');
      expect(envDuringPush.reason).toBe('micro-worktree push for wu:claim (automated)');

      // Verify pushRefspec was called with correct args
      expect(mockGitAdapter.pushRefspec).toHaveBeenCalledWith(
        'origin',
        'tmp/wu-claim/wu-123',
        'main',
      );
    });

    it('should restore original LUMENFLOW_FORCE after push', async () => {
      const { pushRefspecWithForce } = await import('../micro-worktree.js');

      // Set existing env values
      process.env.LUMENFLOW_FORCE = 'original-force';
      process.env.LUMENFLOW_FORCE_REASON = 'original-reason';

      const mockGitAdapter = {
        pushRefspec: vi.fn().mockResolvedValue(undefined),
      };

      await pushRefspecWithForce(
        mockGitAdapter as never,
        'origin',
        'tmp/test',
        'main',
        'test reason',
      );

      // After push, original values should be restored
      expect(process.env.LUMENFLOW_FORCE).toBe('original-force');
      expect(process.env.LUMENFLOW_FORCE_REASON).toBe('original-reason');
    });

    it('should restore undefined LUMENFLOW_FORCE after push', async () => {
      const { pushRefspecWithForce } = await import('../micro-worktree.js');

      // Ensure env vars are not set
      delete process.env.LUMENFLOW_FORCE;
      delete process.env.LUMENFLOW_FORCE_REASON;

      const mockGitAdapter = {
        pushRefspec: vi.fn().mockResolvedValue(undefined),
      };

      await pushRefspecWithForce(
        mockGitAdapter as never,
        'origin',
        'tmp/test',
        'main',
        'test reason',
      );

      // After push, env vars should still be undefined
      expect(process.env.LUMENFLOW_FORCE).toBeUndefined();
      expect(process.env.LUMENFLOW_FORCE_REASON).toBeUndefined();
    });

    it('should restore env vars even if push fails', async () => {
      const { pushRefspecWithForce } = await import('../micro-worktree.js');

      process.env.LUMENFLOW_FORCE = 'original';
      process.env.LUMENFLOW_FORCE_REASON = 'original-reason';

      const mockGitAdapter = {
        pushRefspec: vi.fn().mockRejectedValue(new Error('Push failed')),
      };

      await expect(
        pushRefspecWithForce(mockGitAdapter as never, 'origin', 'tmp/test', 'main', 'test'),
      ).rejects.toThrow('Push failed');

      // Original values should be restored even after error
      expect(process.env.LUMENFLOW_FORCE).toBe('original');
      expect(process.env.LUMENFLOW_FORCE_REASON).toBe('original-reason');
    });
  });

  describe('LUMENFLOW_FORCE constants', () => {
    it('should export LUMENFLOW_FORCE_ENV constant', async () => {
      const { LUMENFLOW_FORCE_ENV } = await import('../micro-worktree.js');
      expect(LUMENFLOW_FORCE_ENV).toBe('LUMENFLOW_FORCE');
    });

    it('should export LUMENFLOW_FORCE_REASON_ENV constant', async () => {
      const { LUMENFLOW_FORCE_REASON_ENV } = await import('../micro-worktree.js');
      expect(LUMENFLOW_FORCE_REASON_ENV).toBe('LUMENFLOW_FORCE_REASON');
    });
  });

  /**
   * WU-1179: Tests for push race condition handling
   *
   * When micro-worktree operations push to origin/main and fail because origin
   * advanced (race condition with parallel agents), the local main should be
   * rolled back to origin/main and the operation should retry.
   */
  describe('MAX_PUSH_RETRIES constant (WU-1179)', () => {
    it('should export MAX_PUSH_RETRIES constant with value 3', async () => {
      const { MAX_PUSH_RETRIES } = await import('../micro-worktree.js');
      expect(MAX_PUSH_RETRIES).toBe(3);
    });
  });

  describe('pushWithRetry (WU-1179)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      delete process.env.LUMENFLOW_FORCE;
      delete process.env.LUMENFLOW_FORCE_REASON;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('should succeed on first push attempt', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      const mockMainGit = {
        push: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      await pushWithRetry(
        mockMainGit as never,
        mockWorktreeGit as never,
        'origin',
        'main',
        'tmp/wu-create/wu-123',
        '[test]',
      );

      expect(mockMainGit.push).toHaveBeenCalledTimes(1);
      expect(mockMainGit.push).toHaveBeenCalledWith('origin', 'main');
      // No retry operations should have been called
      expect(mockMainGit.fetch).not.toHaveBeenCalled();
    });

    it('should retry on push failure and succeed on second attempt', async () => {
      const { pushWithRetry, MAX_PUSH_RETRIES } = await import('../micro-worktree.js');

      // First push fails (race condition), second succeeds
      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error('rejected: non-fast-forward'))
          .mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      await pushWithRetry(
        mockMainGit as never,
        mockWorktreeGit as never,
        'origin',
        'main',
        'tmp/wu-create/wu-123',
        '[test]',
      );

      // Push should be called twice
      expect(mockMainGit.push).toHaveBeenCalledTimes(2);

      // Rollback should happen: reset local main to origin/main
      expect(mockMainGit.reset).toHaveBeenCalledWith('origin/main', { hard: true });

      // Fetch origin/main
      expect(mockMainGit.fetch).toHaveBeenCalledWith('origin', 'main');

      // Update local main via ff-only merge
      expect(mockMainGit.merge).toHaveBeenCalledWith('origin/main', { ffOnly: true });

      // Rebase temp branch on updated main
      expect(mockWorktreeGit.rebase).toHaveBeenCalledWith('main');
    });

    it('should fail after MAX_PUSH_RETRIES attempts', async () => {
      const { pushWithRetry, MAX_PUSH_RETRIES } = await import('../micro-worktree.js');

      // All push attempts fail
      const mockMainGit = {
        push: vi.fn().mockRejectedValue(new Error('rejected: non-fast-forward')),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      await expect(
        pushWithRetry(
          mockMainGit as never,
          mockWorktreeGit as never,
          'origin',
          'main',
          'tmp/wu-create/wu-123',
          '[test]',
        ),
      ).rejects.toThrow(`Push failed after ${MAX_PUSH_RETRIES} attempts`);

      // Push should be called MAX_PUSH_RETRIES times
      expect(mockMainGit.push).toHaveBeenCalledTimes(MAX_PUSH_RETRIES);

      // Rollback should happen MAX_PUSH_RETRIES - 1 times (not on last failure)
      expect(mockMainGit.reset).toHaveBeenCalledTimes(MAX_PUSH_RETRIES - 1);
    });

    it('should roll back local main to origin/main on push failure', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      // First push fails, second succeeds
      const mockMainGit = {
        push: vi.fn().mockRejectedValueOnce(new Error('rejected')).mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      await pushWithRetry(
        mockMainGit as never,
        mockWorktreeGit as never,
        'origin',
        'main',
        'tmp/wu-create/wu-123',
        '[test]',
      );

      // Key acceptance criterion: rollback local main to origin/main
      expect(mockMainGit.reset).toHaveBeenCalledWith('origin/main', { hard: true });
    });
  });

  describe('withMicroWorktree fetch origin/main before start (WU-1179)', () => {
    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should fetch origin/main before starting non-pushOnly operations', async () => {
      // This test verifies the acceptance criterion:
      // "withMicroWorktree fetches origin/main before starting"

      // We need to mock the git-adapter module to track fetch calls
      const mockFetch = vi.fn().mockResolvedValue(undefined);
      const mockMerge = vi.fn().mockResolvedValue(undefined);
      const mockCreateBranchNoCheckout = vi.fn().mockResolvedValue(undefined);
      const mockWorktreeAddExisting = vi.fn().mockResolvedValue(undefined);
      const mockWorktreeList = vi.fn().mockResolvedValue('');
      const mockBranchExists = vi.fn().mockResolvedValue(false);
      const mockWorktreeRemove = vi.fn().mockResolvedValue(undefined);
      const mockDeleteBranch = vi.fn().mockResolvedValue(undefined);
      const mockPush = vi.fn().mockResolvedValue(undefined);
      const mockAddWithDeletions = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockResolvedValue(undefined);
      const mockRebase = vi.fn().mockResolvedValue(undefined);

      vi.doMock('../git-adapter.js', () => ({
        getGitForCwd: vi.fn(() => ({
          fetch: mockFetch,
          merge: mockMerge,
          createBranchNoCheckout: mockCreateBranchNoCheckout,
          worktreeAddExisting: mockWorktreeAddExisting,
          worktreeList: mockWorktreeList,
          branchExists: mockBranchExists,
          worktreeRemove: mockWorktreeRemove,
          deleteBranch: mockDeleteBranch,
          push: mockPush,
        })),
        createGitForPath: vi.fn(() => ({
          addWithDeletions: mockAddWithDeletions,
          commit: mockCommit,
          rebase: mockRebase,
        })),
      }));

      const { withMicroWorktree } = await import('../micro-worktree.js');

      // Execute should return quickly for this test
      const mockExecute = vi.fn().mockResolvedValue({
        commitMessage: 'test commit',
        files: ['test.txt'],
      });

      try {
        await withMicroWorktree({
          operation: 'test-op',
          id: 'WU-TEST',
          logPrefix: '[test]',
          pushOnly: false, // Standard mode (not push-only)
          execute: mockExecute,
        });
      } catch {
        // We expect this to fail due to partial mocking, but we can still verify fetch was called
      }

      // Verify that fetch was called with origin and main BEFORE any other operations
      // The first call to any git operation after cleanup should be fetch
      expect(mockFetch).toHaveBeenCalledWith('origin', 'main');

      // Fetch should be called before createBranchNoCheckout (the first real operation)
      const fetchCallOrder = mockFetch.mock.invocationCallOrder[0];
      const createBranchCallOrder = mockCreateBranchNoCheckout.mock.invocationCallOrder[0];
      if (createBranchCallOrder !== undefined && fetchCallOrder !== undefined) {
        expect(fetchCallOrder).toBeLessThan(createBranchCallOrder);
      }
    });
  });
});
