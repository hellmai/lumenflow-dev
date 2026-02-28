// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Tests for micro-worktree operations
 *
 * WU-1081: Tests for LUMENFLOW_FORCE environment variable handling
 * during push-only mode in withMicroWorktree.
 *
 * WU-1179: Tests for push race condition handling (fetch before start,
 * rollback + retry on push failure).
 *
 * WU-1332: Tests for configurable push retry with p-retry.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WORKSPACE_CONFIG_FILE_NAME, WORKSPACE_V2_KEYS } from '../config-contract.js';

// Test constants to satisfy sonarjs/no-duplicate-string
const TEST_REMOTE = 'origin';
const TEST_BRANCH = 'main';
const TEST_TEMP_BRANCH = 'tmp/wu-create/wu-123';
const TEST_LOG_PREFIX = '[test]';
const ORIGINAL_FORCE = 'original-force';
const ORIGINAL_REASON = 'original-reason';
const NON_FAST_FORWARD_ERROR = 'rejected: non-fast-forward';
// WU-1348: HARD_RESET_OPTION removed - retry logic no longer resets main checkout
const FF_ONLY_OPTION = { ffOnly: true };
const TEST_RETRIES = 3;
const EXPECT_FAIL_MSG = 'Should have thrown';
const ORIGIN_MAIN_REF = 'origin/main';
const TEST_OPERATION_INIT_ADD = 'initiative-add-wu';
const TEST_OPERATION_INIT_REMOVE = 'initiative-remove-wu';
const TEST_OPERATION = 'test-op';
const TEST_PUSH_ONLY_REASON = 'push-only test';

describe('micro-worktree', () => {
  describe('pushRefspecWithForce', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      // Clear UnsafeAny existing LUMENFLOW_FORCE values
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
        TEST_REMOTE,
        'tmp/wu-claim/wu-123',
        TEST_BRANCH,
        'micro-worktree push for wu:claim (automated)',
      );

      // Verify LUMENFLOW_FORCE was set to '1' during the push
      expect(envDuringPush.force).toBe('1');
      expect(envDuringPush.reason).toBe('micro-worktree push for wu:claim (automated)');

      // Verify pushRefspec was called with correct args
      expect(mockGitAdapter.pushRefspec).toHaveBeenCalledWith(
        TEST_REMOTE,
        'tmp/wu-claim/wu-123',
        TEST_BRANCH,
      );
    });

    it('should restore original LUMENFLOW_FORCE after push', async () => {
      const { pushRefspecWithForce } = await import('../micro-worktree.js');

      // Set existing env values
      process.env.LUMENFLOW_FORCE = ORIGINAL_FORCE;
      process.env.LUMENFLOW_FORCE_REASON = ORIGINAL_REASON;

      const mockGitAdapter = {
        pushRefspec: vi.fn().mockResolvedValue(undefined),
      };

      await pushRefspecWithForce(
        mockGitAdapter as never,
        TEST_REMOTE,
        'tmp/test',
        TEST_BRANCH,
        'test reason',
      );

      // After push, original values should be restored
      expect(process.env.LUMENFLOW_FORCE).toBe(ORIGINAL_FORCE);
      expect(process.env.LUMENFLOW_FORCE_REASON).toBe(ORIGINAL_REASON);
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
        TEST_REMOTE,
        'tmp/test',
        TEST_BRANCH,
        'test reason',
      );

      // After push, env vars should still be undefined
      expect(process.env.LUMENFLOW_FORCE).toBeUndefined();
      expect(process.env.LUMENFLOW_FORCE_REASON).toBeUndefined();
    });

    it('should restore env vars even if push fails', async () => {
      const { pushRefspecWithForce } = await import('../micro-worktree.js');

      process.env.LUMENFLOW_FORCE = 'original';
      process.env.LUMENFLOW_FORCE_REASON = ORIGINAL_REASON;

      const mockGitAdapter = {
        pushRefspec: vi.fn().mockRejectedValue(new Error('Push failed')),
      };

      await expect(
        pushRefspecWithForce(mockGitAdapter as never, TEST_REMOTE, 'tmp/test', TEST_BRANCH, 'test'),
      ).rejects.toThrow('Push failed');

      // Original values should be restored even after error
      expect(process.env.LUMENFLOW_FORCE).toBe('original');
      expect(process.env.LUMENFLOW_FORCE_REASON).toBe(ORIGINAL_REASON);
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
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
      );

      expect(mockMainGit.push).toHaveBeenCalledTimes(1);
      expect(mockMainGit.push).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);
      // No retry operations should have been called
      expect(mockMainGit.fetch).not.toHaveBeenCalled();
    });

    it('should retry on push failure and succeed on second attempt', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      // First push fails (race condition), second succeeds
      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error(NON_FAST_FORWARD_ERROR))
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
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
      );

      // Push should be called twice
      expect(mockMainGit.push).toHaveBeenCalledTimes(2);

      // WU-1348: NO hard reset should happen - preserve micro-worktree isolation
      expect(mockMainGit.reset).not.toHaveBeenCalled();

      // Fetch origin/main
      expect(mockMainGit.fetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);

      // Re-merge temp branch to local main (ff-only) after rebase
      expect(mockMainGit.merge).toHaveBeenCalledWith(TEST_TEMP_BRANCH, FF_ONLY_OPTION);

      // Rebase temp branch on updated origin/main
      expect(mockWorktreeGit.rebase).toHaveBeenCalledWith(ORIGIN_MAIN_REF);
    });

    it('should recover when ff-only re-merge fails by rebasing local main onto temp branch', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error(NON_FAST_FORWARD_ERROR))
          .mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi
          .fn()
          .mockRejectedValueOnce(new Error('fatal: Not possible to fast-forward, aborting.')),
        rebase: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      await pushWithRetry(
        mockMainGit as never,
        mockWorktreeGit as never,
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
      );

      expect(mockMainGit.push).toHaveBeenCalledTimes(2);
      expect(mockMainGit.fetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);
      expect(mockWorktreeGit.rebase).toHaveBeenCalledWith(ORIGIN_MAIN_REF);
      expect(mockMainGit.merge).toHaveBeenCalledWith(TEST_TEMP_BRANCH, FF_ONLY_OPTION);
      expect(mockMainGit.rebase).toHaveBeenCalledWith(TEST_TEMP_BRANCH);
    });

    it('should fail after MAX_PUSH_RETRIES attempts', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');
      const expectedRetries = 3; // MAX_PUSH_RETRIES value

      // All push attempts fail
      const mockMainGit = {
        push: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
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
          TEST_REMOTE,
          TEST_BRANCH,
          TEST_TEMP_BRANCH,
          TEST_LOG_PREFIX,
        ),
      ).rejects.toThrow(`Push failed after ${expectedRetries} attempts`);

      // Push should be called MAX_PUSH_RETRIES times
      expect(mockMainGit.push).toHaveBeenCalledTimes(expectedRetries);

      // WU-1348: NO hard reset should happen - preserve micro-worktree isolation
      expect(mockMainGit.reset).not.toHaveBeenCalled();

      // Rebase should happen for each retry (not on last failure)
      expect(mockWorktreeGit.rebase).toHaveBeenCalledTimes(expectedRetries - 1);
    });

    it('should fetch and rebase (not reset) on push failure', async () => {
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
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
      );

      // WU-1348: Key change - NO hard reset, use fetch+rebase instead
      expect(mockMainGit.reset).not.toHaveBeenCalled();
      expect(mockMainGit.fetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);
      expect(mockWorktreeGit.rebase).toHaveBeenCalledWith(ORIGIN_MAIN_REF);
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

      // Extract mock factories to avoid deeply nested functions
      const mainGitMock = {
        fetch: mockFetch,
        merge: mockMerge,
        createBranchNoCheckout: mockCreateBranchNoCheckout,
        worktreeAddExisting: mockWorktreeAddExisting,
        worktreeList: mockWorktreeList,
        branchExists: mockBranchExists,
        worktreeRemove: mockWorktreeRemove,
        deleteBranch: mockDeleteBranch,
        push: mockPush,
      };
      const worktreeGitMock = {
        addWithDeletions: mockAddWithDeletions,
        commit: mockCommit,
        rebase: mockRebase,
      };

      const createMainGit = (): typeof mainGitMock => mainGitMock;
      const createWorktreeGit = (): typeof worktreeGitMock => worktreeGitMock;
      vi.doMock('../git-adapter.js', () => ({
        getGitForCwd: vi.fn(createMainGit),
        createGitForPath: vi.fn(createWorktreeGit),
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
          logPrefix: TEST_LOG_PREFIX,
          pushOnly: false, // Standard mode (not push-only)
          execute: mockExecute,
        });
      } catch {
        // We expect this to fail due to partial mocking, but we can still verify fetch was called
      }

      // Verify that fetch was called with origin and main BEFORE UnsafeAny other operations
      expect(mockFetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);

      // Fetch should be called before createBranchNoCheckout (the first real operation)
      const fetchCallOrder = mockFetch.mock.invocationCallOrder[0];
      const createBranchCallOrder = mockCreateBranchNoCheckout.mock.invocationCallOrder[0];
      if (createBranchCallOrder !== undefined && fetchCallOrder !== undefined) {
        expect(fetchCallOrder).toBeLessThan(createBranchCallOrder);
      }
    });

    it('should fetch origin/main and branch from origin/main in pushOnly mode', async () => {
      const mockFetch = vi.fn().mockResolvedValue(undefined);
      const mockMerge = vi.fn().mockResolvedValue(undefined);
      const mockCreateBranchNoCheckout = vi.fn().mockResolvedValue(undefined);
      const mockWorktreeAddExisting = vi.fn().mockResolvedValue(undefined);
      const mockWorktreeList = vi.fn().mockResolvedValue('');
      const mockBranchExists = vi.fn().mockResolvedValue(false);
      const mockWorktreeRemove = vi.fn().mockResolvedValue(undefined);
      const mockDeleteBranch = vi.fn().mockResolvedValue(undefined);
      const mockAddWithDeletions = vi.fn().mockResolvedValue(undefined);
      const mockCommit = vi.fn().mockResolvedValue(undefined);
      const mockRebase = vi.fn().mockResolvedValue(undefined);

      const mainGitMock = {
        fetch: mockFetch,
        merge: mockMerge,
        createBranchNoCheckout: mockCreateBranchNoCheckout,
        worktreeAddExisting: mockWorktreeAddExisting,
        worktreeList: mockWorktreeList,
        branchExists: mockBranchExists,
        worktreeRemove: mockWorktreeRemove,
        deleteBranch: mockDeleteBranch,
      };
      const worktreeGitMock = {
        addWithDeletions: mockAddWithDeletions,
        commit: mockCommit,
        rebase: mockRebase,
      };

      const createMainGit = (): typeof mainGitMock => mainGitMock;
      const createWorktreeGit = (): typeof worktreeGitMock => worktreeGitMock;
      vi.doMock('../git-adapter.js', () => ({
        getGitForCwd: vi.fn(createMainGit),
        createGitForPath: vi.fn(createWorktreeGit),
      }));

      const { withMicroWorktree } = await import('../micro-worktree.js');

      const mockExecute = vi.fn().mockResolvedValue({
        commitMessage: 'test commit',
        files: ['test.txt'],
      });

      try {
        await withMicroWorktree({
          operation: 'test-op',
          id: 'WU-TEST',
          logPrefix: TEST_LOG_PREFIX,
          pushOnly: true,
          execute: mockExecute,
        });
      } catch {
        // Partial mocking is expected to fail in push phase.
      }

      expect(mockFetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);
      expect(mockMerge).not.toHaveBeenCalledWith(ORIGIN_MAIN_REF, FF_ONLY_OPTION);
      const expectedTempBranch = 'tmp/test-op/wu-test';
      expect(mockCreateBranchNoCheckout).toHaveBeenCalledWith(expectedTempBranch, ORIGIN_MAIN_REF);

      const fetchCallOrder = mockFetch.mock.invocationCallOrder[0];
      const createBranchCallOrder = mockCreateBranchNoCheckout.mock.invocationCallOrder[0];
      if (createBranchCallOrder !== undefined && fetchCallOrder !== undefined) {
        expect(fetchCallOrder).toBeLessThan(createBranchCallOrder);
      }
    });
  });

  /**
   * WU-1332: Tests for configurable push retry with p-retry
   *
   * When micro-worktree operations push to origin/main and fail because origin
   * advanced (non-fast-forward), the system should retry with exponential backoff
   * using the configurable git.push_retry settings.
   */
  describe('pushWithRetryConfig (WU-1332)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      delete process.env.LUMENFLOW_FORCE;
      delete process.env.LUMENFLOW_FORCE_REASON;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it('should export PushRetryConfig type and defaults', async () => {
      const { DEFAULT_PUSH_RETRY_CONFIG } = await import('../micro-worktree.js');

      // Verify default configuration structure
      expect(DEFAULT_PUSH_RETRY_CONFIG).toBeDefined();
      expect(DEFAULT_PUSH_RETRY_CONFIG.enabled).toBe(true);
      expect(DEFAULT_PUSH_RETRY_CONFIG.retries).toBe(3);
      expect(DEFAULT_PUSH_RETRY_CONFIG.min_delay_ms).toBe(100);
      expect(DEFAULT_PUSH_RETRY_CONFIG.max_delay_ms).toBe(1000);
      expect(DEFAULT_PUSH_RETRY_CONFIG.jitter).toBe(true);
    });

    it('should export resolvePushRetryConfig helper (WU-1459)', async () => {
      const mod = await import('../micro-worktree.js');
      expect(typeof mod.resolvePushRetryConfig).toBe('function');
    });

    it('should apply operation override over global push_retry config (WU-1459)', async () => {
      const { resolvePushRetryConfig } = await import('../micro-worktree.js');

      const globalConfig = {
        enabled: true,
        retries: 3,
        min_delay_ms: 100,
        max_delay_ms: 1000,
        jitter: true,
      };
      const override = {
        retries: 8,
        min_delay_ms: 300,
        max_delay_ms: 4000,
      };

      const resolved = resolvePushRetryConfig(globalConfig, override);

      expect(resolved.enabled).toBe(true);
      expect(resolved.jitter).toBe(true);
      expect(resolved.retries).toBe(8);
      expect(resolved.min_delay_ms).toBe(300);
      expect(resolved.max_delay_ms).toBe(4000);
    });

    it('should respect configured retry count', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      // All push attempts fail
      const mockMainGit = {
        push: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      // Configure with 5 retries
      const config = {
        enabled: true,
        retries: 5,
        min_delay_ms: 10, // Fast for tests
        max_delay_ms: 50,
        jitter: false,
      };

      await expect(
        pushWithRetryConfig(
          mockMainGit as never,
          mockWorktreeGit as never,
          TEST_REMOTE,
          TEST_BRANCH,
          TEST_TEMP_BRANCH,
          TEST_LOG_PREFIX,
          config,
        ),
      ).rejects.toThrow('Push failed after 5 attempts');

      // Push should be called 5 times (1 initial + 4 retries)
      expect(mockMainGit.push).toHaveBeenCalledTimes(5);
    });

    it('should recover from ff-only re-merge failure by rebasing local main onto temp branch', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error(NON_FAST_FORWARD_ERROR))
          .mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi
          .fn()
          .mockRejectedValueOnce(new Error('fatal: Not possible to fast-forward, aborting.')),
        rebase: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      await pushWithRetryConfig(
        mockMainGit as never,
        mockWorktreeGit as never,
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        {
          enabled: true,
          retries: TEST_RETRIES,
          min_delay_ms: 10,
          max_delay_ms: 20,
          jitter: false,
        },
      );

      expect(mockMainGit.push).toHaveBeenCalledTimes(2);
      expect(mockMainGit.fetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);
      expect(mockWorktreeGit.rebase).toHaveBeenCalledWith(ORIGIN_MAIN_REF);
      expect(mockMainGit.merge).toHaveBeenCalledWith(TEST_TEMP_BRANCH, FF_ONLY_OPTION);
      expect(mockMainGit.rebase).toHaveBeenCalledWith(TEST_TEMP_BRANCH);
    });

    it('should not retry when push_retry.enabled is false', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      // First push fails
      const mockMainGit = {
        push: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      // Disable retries
      const config = {
        enabled: false,
        retries: TEST_RETRIES,
        min_delay_ms: 100,
        max_delay_ms: 1000,
        jitter: true,
      };

      await expect(
        pushWithRetryConfig(
          mockMainGit as never,
          mockWorktreeGit as never,
          TEST_REMOTE,
          TEST_BRANCH,
          TEST_TEMP_BRANCH,
          TEST_LOG_PREFIX,
          config,
        ),
      ).rejects.toThrow('non-fast-forward');

      // Push should only be called once (no retry)
      expect(mockMainGit.push).toHaveBeenCalledTimes(1);
      // No rollback operations
      expect(mockMainGit.reset).not.toHaveBeenCalled();
    });

    it('should apply exponential backoff between retries', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      const pushTimes: number[] = [];
      const mockMainGit = {
        push: vi.fn().mockImplementation(() => {
          pushTimes.push(Date.now());
          return Promise.reject(new Error(NON_FAST_FORWARD_ERROR));
        }),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      // Configure with measurable delays (no jitter for predictability)
      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 50,
        max_delay_ms: 200,
        jitter: false,
      };

      await expect(
        pushWithRetryConfig(
          mockMainGit as never,
          mockWorktreeGit as never,
          TEST_REMOTE,
          TEST_BRANCH,
          TEST_TEMP_BRANCH,
          TEST_LOG_PREFIX,
          config,
        ),
      ).rejects.toThrow();

      // Verify there was some delay between attempts
      // (exact timing varies, just verify it's not instant)
      expect(pushTimes.length).toBe(3);
      if (pushTimes.length >= 2) {
        const delay1 = pushTimes[1] - pushTimes[0];
        expect(delay1).toBeGreaterThanOrEqual(40); // Allow some variance
      }
    });

    it('should provide clear guidance message after max retries', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      const mockMainGit = {
        push: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: 2,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      try {
        await pushWithRetryConfig(
          mockMainGit as never,
          mockWorktreeGit as never,
          TEST_REMOTE,
          TEST_BRANCH,
          TEST_TEMP_BRANCH,
          TEST_LOG_PREFIX,
          config,
        );
        expect.fail(EXPECT_FAIL_MSG);
      } catch (error) {
        const message = (error as Error).message;
        // Should include retry count
        expect(message).toContain('2 attempts');
        // Should include guidance about high traffic
        expect(message).toContain('traffic');
        // Should suggest waiting or retrying
        expect(message).toMatch(/retry|wait/i);
      }
    });

    it('should succeed without retry when push works first time', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      const mockMainGit = {
        push: vi.fn().mockResolvedValue(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 100,
        max_delay_ms: 1000,
        jitter: true,
      };

      await pushWithRetryConfig(
        mockMainGit as never,
        mockWorktreeGit as never,
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        config,
      );

      // Push should be called exactly once
      expect(mockMainGit.push).toHaveBeenCalledTimes(1);
      // No rollback operations needed
      expect(mockMainGit.reset).not.toHaveBeenCalled();
      expect(mockMainGit.fetch).not.toHaveBeenCalled();
    });

    it('should log retry attempts with attempt number', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');
      const consoleSpy = vi.spyOn(console, 'log');

      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error('rejected'))
          .mockRejectedValueOnce(new Error('rejected'))
          .mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      await pushWithRetryConfig(
        mockMainGit as never,
        mockWorktreeGit as never,
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        config,
      );

      // Should log attempt numbers
      const logCalls = consoleSpy.mock.calls.map((c) => c[0]);
      expect(logCalls.some((log) => log.includes('attempt 1'))).toBe(true);
      expect(logCalls.some((log) => log.includes('attempt 2'))).toBe(true);
      expect(logCalls.some((log) => log.includes('attempt 3'))).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  /**
   * WU-1336: Tests for centralized retry exhaustion handling
   *
   * When micro-worktree push retries are exhausted, provide a typed error
   * and helper functions so CLI commands do not need to duplicate detection logic.
   */
  describe('retry exhaustion handling (WU-1336)', () => {
    it('should export RetryExhaustionError class', async () => {
      const { RetryExhaustionError } = await import('../micro-worktree.js');
      expect(RetryExhaustionError).toBeDefined();
      expect(typeof RetryExhaustionError).toBe('function');
    });

    it('should create RetryExhaustionError with operation and retries', async () => {
      const { RetryExhaustionError } = await import('../micro-worktree.js');

      const error = new RetryExhaustionError(TEST_OPERATION_INIT_ADD, 3);

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe('RetryExhaustionError');
      expect(error.operation).toBe(TEST_OPERATION_INIT_ADD);
      expect(error.retries).toBe(3);
      expect(error.message).toContain('3 attempts');
    });

    it('should export isRetryExhaustionError type guard', async () => {
      const { isRetryExhaustionError, RetryExhaustionError } = await import('../micro-worktree.js');

      expect(typeof isRetryExhaustionError).toBe('function');

      // Should return true for RetryExhaustionError
      const retryError = new RetryExhaustionError(TEST_OPERATION, 3);
      expect(isRetryExhaustionError(retryError)).toBe(true);

      // Should return false for regular errors
      const regularError = new Error('Some other error');
      expect(isRetryExhaustionError(regularError)).toBe(false);
    });

    it('should detect legacy retry exhaustion error messages', async () => {
      const { isRetryExhaustionError } = await import('../micro-worktree.js');

      // Should also detect errors thrown by the legacy pushWithRetryConfig
      const legacyError = new Error(
        'Push failed after 3 attempts. Origin main may have significant traffic.',
      );
      expect(isRetryExhaustionError(legacyError)).toBe(true);
    });

    it('should export formatRetryExhaustionError helper', async () => {
      const { formatRetryExhaustionError, RetryExhaustionError } =
        await import('../micro-worktree.js');

      expect(typeof formatRetryExhaustionError).toBe('function');

      const error = new RetryExhaustionError(TEST_OPERATION_INIT_ADD, 3);
      const formatted = formatRetryExhaustionError(error, {
        command: 'pnpm initiative:add-wu --wu WU-123 --initiative INIT-001',
      });

      // Should include actionable next steps
      expect(formatted).toContain('Next steps:');
      expect(formatted).toContain('Wait a few seconds');
      expect(formatted).toContain('initiative:add-wu');
    });

    it('should include the retry command in formatted error', async () => {
      const { formatRetryExhaustionError, RetryExhaustionError } =
        await import('../micro-worktree.js');

      const error = new RetryExhaustionError(TEST_OPERATION_INIT_REMOVE, 5);
      const formatted = formatRetryExhaustionError(error, {
        command: 'pnpm initiative:remove-wu --wu WU-456 --initiative INIT-002',
      });

      expect(formatted).toContain('--wu WU-456');
      expect(formatted).toContain('--initiative INIT-002');
    });

    it('should suggest concurrent agent check in formatted error', async () => {
      const { formatRetryExhaustionError, RetryExhaustionError } =
        await import('../micro-worktree.js');

      const error = new RetryExhaustionError(TEST_OPERATION, 3);
      const formatted = formatRetryExhaustionError(error, {
        command: 'pnpm test:command',
      });

      // Should mention concurrent agents as possible cause
      expect(formatted).toMatch(/concurrent|agent|traffic/i);
    });

    it('should suggest increasing retries in config', async () => {
      const { formatRetryExhaustionError, RetryExhaustionError } =
        await import('../micro-worktree.js');

      const error = new RetryExhaustionError(TEST_OPERATION, 3);
      const formatted = formatRetryExhaustionError(error, {
        command: 'pnpm test:command',
      });

      expect(formatted).toContain('git.push_retry.retries');
      expect(formatted).toContain(WORKSPACE_CONFIG_FILE_NAME);
      expect(formatted).toContain(WORKSPACE_V2_KEYS.SOFTWARE_DELIVERY);
    });
  });

  /**
   * WU-1337: Tests for push-only path retry with rebase
   *
   * When micro-worktree operations use pushOnly mode (e.g., initiative:add-wu,
   * wu:claim), the push should retry with rebase on non-fast-forward errors
   * using the git.push_retry configuration.
   */
  describe('pushRefspecWithRetry (WU-1337)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      delete process.env.LUMENFLOW_FORCE;
      delete process.env.LUMENFLOW_FORCE_REASON;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it('should export pushRefspecWithRetry function', async () => {
      const { pushRefspecWithRetry } = await import('../micro-worktree.js');
      expect(typeof pushRefspecWithRetry).toBe('function');
    });

    it('should succeed on first push attempt', async () => {
      const { pushRefspecWithRetry, DEFAULT_PUSH_RETRY_CONFIG } =
        await import('../micro-worktree.js');

      // Track what env vars were set during the push
      let envDuringPush: { force?: string; reason?: string } = {};

      const mockGitWorktree = {
        pushRefspec: vi.fn().mockImplementation(async () => {
          envDuringPush = {
            force: process.env.LUMENFLOW_FORCE,
            reason: process.env.LUMENFLOW_FORCE_REASON,
          };
        }),
        fetch: vi.fn().mockResolvedValue(undefined),
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const mockMainGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
      };

      await pushRefspecWithRetry(
        mockGitWorktree as never,
        mockMainGit as never,
        TEST_REMOTE,
        TEST_TEMP_BRANCH,
        TEST_BRANCH,
        TEST_PUSH_ONLY_REASON,
        TEST_LOG_PREFIX,
        DEFAULT_PUSH_RETRY_CONFIG,
      );

      // Verify LUMENFLOW_FORCE was set during the push
      expect(envDuringPush.force).toBe('1');
      expect(envDuringPush.reason).toBe(TEST_PUSH_ONLY_REASON);

      // Push should be called exactly once
      expect(mockGitWorktree.pushRefspec).toHaveBeenCalledTimes(1);

      // No rebase operations needed
      expect(mockGitWorktree.rebase).not.toHaveBeenCalled();
    });

    it('should retry with rebase on non-fast-forward error', async () => {
      const { pushRefspecWithRetry } = await import('../micro-worktree.js');

      // First push fails (non-fast-forward), second succeeds
      const mockGitWorktree = {
        pushRefspec: vi
          .fn()
          .mockRejectedValueOnce(new Error(NON_FAST_FORWARD_ERROR))
          .mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const mockMainGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10, // Fast for tests
        max_delay_ms: 50,
        jitter: false,
      };

      await pushRefspecWithRetry(
        mockGitWorktree as never,
        mockMainGit as never,
        TEST_REMOTE,
        TEST_TEMP_BRANCH,
        TEST_BRANCH,
        TEST_PUSH_ONLY_REASON,
        TEST_LOG_PREFIX,
        config,
      );

      // Push should be called twice
      expect(mockGitWorktree.pushRefspec).toHaveBeenCalledTimes(2);

      // Should fetch origin/main and rebase before retry
      expect(mockMainGit.fetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);
      expect(mockGitWorktree.rebase).toHaveBeenCalledWith(ORIGIN_MAIN_REF);
    });

    it('should respect configured retry count', async () => {
      const { pushRefspecWithRetry } = await import('../micro-worktree.js');

      // All push attempts fail
      const mockGitWorktree = {
        pushRefspec: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const mockMainGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
      };

      // Configure with 5 retries
      const config = {
        enabled: true,
        retries: 5,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      await expect(
        pushRefspecWithRetry(
          mockGitWorktree as never,
          mockMainGit as never,
          TEST_REMOTE,
          TEST_TEMP_BRANCH,
          TEST_BRANCH,
          TEST_PUSH_ONLY_REASON,
          TEST_LOG_PREFIX,
          config,
        ),
      ).rejects.toThrow(/Push failed after 5 attempts/);

      // Push should be called 5 times
      expect(mockGitWorktree.pushRefspec).toHaveBeenCalledTimes(5);

      // Rebase should happen after each failure (5 times total, including last attempt)
      // because rebase is part of the retry preparation logic that runs after each failure
      expect(mockGitWorktree.rebase).toHaveBeenCalledTimes(5);
    });

    it('should not retry when push_retry.enabled is false', async () => {
      const { pushRefspecWithRetry } = await import('../micro-worktree.js');

      // First push fails
      const mockGitWorktree = {
        pushRefspec: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const mockMainGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
      };

      // Disable retries
      const config = {
        enabled: false,
        retries: TEST_RETRIES,
        min_delay_ms: 100,
        max_delay_ms: 1000,
        jitter: true,
      };

      await expect(
        pushRefspecWithRetry(
          mockGitWorktree as never,
          mockMainGit as never,
          TEST_REMOTE,
          TEST_TEMP_BRANCH,
          TEST_BRANCH,
          TEST_PUSH_ONLY_REASON,
          TEST_LOG_PREFIX,
          config,
        ),
      ).rejects.toThrow('non-fast-forward');

      // Push should only be called once (no retry)
      expect(mockGitWorktree.pushRefspec).toHaveBeenCalledTimes(1);
      // No rebase operations
      expect(mockGitWorktree.rebase).not.toHaveBeenCalled();
    });

    it('should still use LUMENFLOW_FORCE for refspec push on retries', async () => {
      const { pushRefspecWithRetry } = await import('../micro-worktree.js');

      // Track env vars for each push attempt
      const envDuringPushes: Array<{ force?: string; reason?: string }> = [];

      // First push fails, second succeeds
      const mockGitWorktree = {
        pushRefspec: vi.fn().mockImplementation(async () => {
          envDuringPushes.push({
            force: process.env.LUMENFLOW_FORCE,
            reason: process.env.LUMENFLOW_FORCE_REASON,
          });
          if (envDuringPushes.length === 1) {
            throw new Error(NON_FAST_FORWARD_ERROR);
          }
        }),
        fetch: vi.fn().mockResolvedValue(undefined),
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const mockMainGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      await pushRefspecWithRetry(
        mockGitWorktree as never,
        mockMainGit as never,
        TEST_REMOTE,
        TEST_TEMP_BRANCH,
        TEST_BRANCH,
        TEST_PUSH_ONLY_REASON,
        TEST_LOG_PREFIX,
        config,
      );

      // Both push attempts should have LUMENFLOW_FORCE set
      expect(envDuringPushes.length).toBe(2);
      expect(envDuringPushes[0]?.force).toBe('1');
      expect(envDuringPushes[0]?.reason).toBe(TEST_PUSH_ONLY_REASON);
      expect(envDuringPushes[1]?.force).toBe('1');
      expect(envDuringPushes[1]?.reason).toBe(TEST_PUSH_ONLY_REASON);
    });

    it('should throw RetryExhaustionError after retries exhausted', async () => {
      const { pushRefspecWithRetry, isRetryExhaustionError } = await import('../micro-worktree.js');

      // All push attempts fail
      const mockGitWorktree = {
        pushRefspec: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const mockMainGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      try {
        await pushRefspecWithRetry(
          mockGitWorktree as never,
          mockMainGit as never,
          TEST_REMOTE,
          TEST_TEMP_BRANCH,
          TEST_BRANCH,
          TEST_PUSH_ONLY_REASON,
          TEST_LOG_PREFIX,
          config,
        );
        expect.fail(EXPECT_FAIL_MSG);
      } catch (error) {
        // Should be detectable as retry exhaustion error
        expect(isRetryExhaustionError(error)).toBe(true);
        expect((error as Error).message).toContain('3 attempts');
      }
    });

    it('should log retry attempts with attempt number', async () => {
      const { pushRefspecWithRetry } = await import('../micro-worktree.js');
      const consoleSpy = vi.spyOn(console, 'log');

      // First two pushes fail, third succeeds
      const mockGitWorktree = {
        pushRefspec: vi
          .fn()
          .mockRejectedValueOnce(new Error('rejected'))
          .mockRejectedValueOnce(new Error('rejected'))
          .mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const mockMainGit = {
        fetch: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      await pushRefspecWithRetry(
        mockGitWorktree as never,
        mockMainGit as never,
        TEST_REMOTE,
        TEST_TEMP_BRANCH,
        TEST_BRANCH,
        TEST_PUSH_ONLY_REASON,
        TEST_LOG_PREFIX,
        config,
      );

      // Should log attempt numbers
      const logCalls = consoleSpy.mock.calls.map((c) => c[0]);
      expect(logCalls.some((log) => log.includes('attempt 1'))).toBe(true);
      expect(logCalls.some((log) => log.includes('attempt 2'))).toBe(true);
      expect(logCalls.some((log) => log.includes('attempt 3'))).toBe(true);

      consoleSpy.mockRestore();
    });
  });

  /**
   * WU-1348: Tests for main checkout isolation during push retry
   *
   * The retry logic should NEVER perform hard reset on the main checkout.
   * This prevents mutation of user's working directory and file flash.
   * Retry should happen via micro-worktree isolation (fetch + rebase temp branch).
   */
  describe('main checkout isolation in push retry (WU-1348)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      delete process.env.LUMENFLOW_FORCE;
      delete process.env.LUMENFLOW_FORCE_REASON;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it('pushWithRetry should NOT hard-reset the main checkout on push failure', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      // First push fails (race condition), second succeeds
      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error(NON_FAST_FORWARD_ERROR))
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
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
      );

      // WU-1348: reset should NEVER be called with hard option on main checkout
      // The retry logic should use rebase on temp branch instead
      expect(mockMainGit.reset).not.toHaveBeenCalled();
    });

    it('pushWithRetryConfig should NOT hard-reset the main checkout on push failure', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      // First push fails (race condition), second succeeds
      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error(NON_FAST_FORWARD_ERROR))
          .mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      await pushWithRetryConfig(
        mockMainGit as never,
        mockWorktreeGit as never,
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        config,
      );

      // WU-1348: reset should NEVER be called with hard option on main checkout
      expect(mockMainGit.reset).not.toHaveBeenCalled();
    });

    it('pushWithRetry should only fetch and rebase temp branch, not touch main checkout', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      // First push fails, second succeeds
      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error(NON_FAST_FORWARD_ERROR))
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
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
      );

      // Should fetch origin/main to get latest state
      expect(mockMainGit.fetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);

      // Should rebase temp branch - the ref could be 'main' or 'origin/main'
      // depending on implementation (both are valid after fetch)
      expect(mockWorktreeGit.rebase).toHaveBeenCalled();

      // Should NOT reset main checkout
      expect(mockMainGit.reset).not.toHaveBeenCalled();
    });

    it('pushWithRetryConfig should only fetch and rebase temp branch, not touch main checkout', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      // First push fails, second succeeds
      const mockMainGit = {
        push: vi
          .fn()
          .mockRejectedValueOnce(new Error(NON_FAST_FORWARD_ERROR))
          .mockResolvedValueOnce(undefined),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      await pushWithRetryConfig(
        mockMainGit as never,
        mockWorktreeGit as never,
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        config,
      );

      // Should fetch origin/main to get latest state
      expect(mockMainGit.fetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);

      // Should rebase temp branch - the ref could be 'main' or 'origin/main'
      expect(mockWorktreeGit.rebase).toHaveBeenCalled();

      // Should NOT reset main checkout
      expect(mockMainGit.reset).not.toHaveBeenCalled();
    });

    it('retry should fail cleanly with actionable guidance when retries exhausted', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      // All push attempts fail
      const mockMainGit = {
        push: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
        reset: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      try {
        await pushWithRetry(
          mockMainGit as never,
          mockWorktreeGit as never,
          TEST_REMOTE,
          TEST_BRANCH,
          TEST_TEMP_BRANCH,
          TEST_LOG_PREFIX,
        );
        expect.fail(EXPECT_FAIL_MSG);
      } catch (error) {
        // WU-1348: Should never have called reset during retry attempts
        expect(mockMainGit.reset).not.toHaveBeenCalled();

        // Should provide actionable error message
        const message = (error as Error).message;
        expect(message).toContain('attempts');
        expect(message).toMatch(/retry|wait/i);
      }
    });

    it('main checkout files should remain untouched during multiple retry attempts', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      // Track operations that would modify main checkout
      const mainModifyingOps: string[] = [];

      const mockMainGit = {
        push: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockImplementation(() => {
          mainModifyingOps.push('merge');
          return Promise.resolve();
        }),
        reset: vi.fn().mockImplementation(() => {
          mainModifyingOps.push('reset');
          return Promise.resolve();
        }),
        checkout: vi.fn().mockImplementation(() => {
          mainModifyingOps.push('checkout');
          return Promise.resolve();
        }),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      try {
        await pushWithRetryConfig(
          mockMainGit as never,
          mockWorktreeGit as never,
          TEST_REMOTE,
          TEST_BRANCH,
          TEST_TEMP_BRANCH,
          TEST_LOG_PREFIX,
          config,
        );
      } catch {
        // Expected to fail after retries exhausted
      }

      // WU-1348: No main-checkout-modifying operations should have occurred during retry
      // (reset and checkout would modify files on disk)
      expect(mainModifyingOps).not.toContain('reset');
      expect(mainModifyingOps).not.toContain('checkout');
    });
  });

  /**
   * WU-1365: Tests for LUMENFLOW_WU_TOOL environment variable export
   *
   * The pre-push hook checks for LUMENFLOW_WU_TOOL to allow micro-worktree operations.
   * The constant should be exported for use by CLI commands.
   */
  describe('LUMENFLOW_WU_TOOL_ENV constant (WU-1365)', () => {
    it('should export LUMENFLOW_WU_TOOL_ENV constant', async () => {
      const { LUMENFLOW_WU_TOOL_ENV } = await import('../micro-worktree.js');
      expect(LUMENFLOW_WU_TOOL_ENV).toBe('LUMENFLOW_WU_TOOL');
    });
  });

  /**
   * WU-1365: Tests for prettier availability handling in formatFiles
   *
   * When prettier is not installed or not available, formatFiles should:
   * 1. Skip formatting gracefully without throwing
   * 2. Log a clear, actionable warning message
   */
  describe('formatFiles prettier availability (WU-1365)', () => {
    it('should export isPrettierAvailable function', async () => {
      const { isPrettierAvailable } = await import('../micro-worktree.js');
      expect(typeof isPrettierAvailable).toBe('function');
    });

    it('isPrettierAvailable should return boolean', async () => {
      const { isPrettierAvailable } = await import('../micro-worktree.js');
      const result = isPrettierAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  /**
   * WU-1365: Tests for cleanup on failure
   *
   * Failed operations should always clean up temp worktrees before exit.
   */
  describe('cleanup on failure (WU-1365)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it('should call cleanupMicroWorktree even when execute throws', async () => {
      const mockBranchExists = vi.fn().mockResolvedValue(false);
      const mockDeleteBranch = vi.fn().mockResolvedValue(undefined);
      const mockWorktreeRemove = vi.fn().mockResolvedValue(undefined);
      const mockWorktreeList = vi.fn().mockResolvedValue('');
      const mockCreateBranchNoCheckout = vi.fn().mockResolvedValue(undefined);
      const mockWorktreeAddExisting = vi.fn().mockResolvedValue(undefined);
      const mockFetch = vi.fn().mockResolvedValue(undefined);
      const mockMerge = vi.fn().mockResolvedValue(undefined);

      const mainGitMock = {
        fetch: mockFetch,
        merge: mockMerge,
        createBranchNoCheckout: mockCreateBranchNoCheckout,
        worktreeAddExisting: mockWorktreeAddExisting,
        worktreeList: mockWorktreeList,
        branchExists: mockBranchExists,
        worktreeRemove: mockWorktreeRemove,
        deleteBranch: mockDeleteBranch,
      };

      const createMainGit = (): typeof mainGitMock => mainGitMock;
      const createWorktreeGit = (): Record<string, never> => ({});
      vi.doMock('../git-adapter.js', () => ({
        getGitForCwd: vi.fn(createMainGit),
        createGitForPath: vi.fn(createWorktreeGit),
      }));

      const { withMicroWorktree } = await import('../micro-worktree.js');

      const mockExecute = vi.fn().mockRejectedValue(new Error('Execute failed'));

      await expect(
        withMicroWorktree({
          operation: 'test-op',
          id: 'WU-TEST',
          logPrefix: '[test]',
          pushOnly: false,
          execute: mockExecute,
        }),
      ).rejects.toThrow('Execute failed');

      // Verify cleanup was attempted (branch existence check or deletion attempt)
      expect(mockBranchExists).toHaveBeenCalled();
    });
  });

  /**
   * WU-1418: Tests for LUMENFLOW_WU_TOOL setting during standard push mode
   *
   * When micro-worktree operations use standard mode (not pushOnly), they should
   * set LUMENFLOW_WU_TOOL to the operation name so the pre-push hook recognizes
   * them as legitimate automated operations.
   */
  describe('LUMENFLOW_WU_TOOL in standard push mode (WU-1418)', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
      vi.resetModules();
      delete process.env.LUMENFLOW_FORCE;
      delete process.env.LUMENFLOW_FORCE_REASON;
      delete process.env.LUMENFLOW_WU_TOOL;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
    });

    it('pushWithRetry should set LUMENFLOW_WU_TOOL during push', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      // Track env var during push
      let envDuringPush: string | undefined;

      const mockMainGit = {
        push: vi.fn().mockImplementation(async () => {
          envDuringPush = process.env.LUMENFLOW_WU_TOOL;
        }),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      await pushWithRetry(
        mockMainGit as never,
        mockWorktreeGit as never,
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        'wu-repair', // operation name
      );

      // Verify LUMENFLOW_WU_TOOL was set during push
      expect(envDuringPush).toBe('wu-repair');
    });

    it('pushWithRetry should restore LUMENFLOW_WU_TOOL after push', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      // Set an original value
      process.env.LUMENFLOW_WU_TOOL = 'original-tool';

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
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        'wu-repair',
      );

      // Original value should be restored
      expect(process.env.LUMENFLOW_WU_TOOL).toBe('original-tool');
    });

    it('pushWithRetry should restore undefined LUMENFLOW_WU_TOOL after push', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      // Ensure env var is not set
      delete process.env.LUMENFLOW_WU_TOOL;

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
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        'wu-repair',
      );

      // Should still be undefined
      expect(process.env.LUMENFLOW_WU_TOOL).toBeUndefined();
    });

    it('pushWithRetry should restore env var even if push fails', async () => {
      const { pushWithRetry } = await import('../micro-worktree.js');

      process.env.LUMENFLOW_WU_TOOL = 'original-tool';

      const mockMainGit = {
        push: vi.fn().mockRejectedValue(new Error(NON_FAST_FORWARD_ERROR)),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      await expect(
        pushWithRetry(
          mockMainGit as never,
          mockWorktreeGit as never,
          TEST_REMOTE,
          TEST_BRANCH,
          TEST_TEMP_BRANCH,
          TEST_LOG_PREFIX,
          'wu-repair',
        ),
      ).rejects.toThrow();

      // Original value should be restored even after failure
      expect(process.env.LUMENFLOW_WU_TOOL).toBe('original-tool');
    });

    it('pushWithRetryConfig should set LUMENFLOW_WU_TOOL during push', async () => {
      const { pushWithRetryConfig } = await import('../micro-worktree.js');

      // Track env var during push
      let envDuringPush: string | undefined;

      const mockMainGit = {
        push: vi.fn().mockImplementation(async () => {
          envDuringPush = process.env.LUMENFLOW_WU_TOOL;
        }),
        fetch: vi.fn().mockResolvedValue(undefined),
        merge: vi.fn().mockResolvedValue(undefined),
      };

      const mockWorktreeGit = {
        rebase: vi.fn().mockResolvedValue(undefined),
      };

      const config = {
        enabled: true,
        retries: TEST_RETRIES,
        min_delay_ms: 10,
        max_delay_ms: 50,
        jitter: false,
      };

      await pushWithRetryConfig(
        mockMainGit as never,
        mockWorktreeGit as never,
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
        config,
        'wu-repair', // operation name
      );

      // Verify LUMENFLOW_WU_TOOL was set during push
      expect(envDuringPush).toBe('wu-repair');
    });
  });

  /**
   * WU-1332: Tests for PushRetryConfig schema
   */
  describe('PushRetryConfigSchema (WU-1332)', () => {
    it('should define push_retry in GitConfigSchema', async () => {
      const { GitConfigSchema } = await import('../lumenflow-config-schema.js');

      // Parse config with push_retry
      const result = GitConfigSchema.safeParse({
        push_retry: {
          enabled: true,
          retries: 5,
          min_delay_ms: 200,
          max_delay_ms: 2000,
          jitter: false,
        },
      });

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.push_retry).toEqual({
          enabled: true,
          retries: 5,
          min_delay_ms: 200,
          max_delay_ms: 2000,
          jitter: false,
        });
      }
    });

    it('should provide sensible defaults for push_retry', async () => {
      const { GitConfigSchema } = await import('../lumenflow-config-schema.js');

      // Parse empty config to get defaults
      const result = GitConfigSchema.parse({});

      expect(result.push_retry).toBeDefined();
      expect(result.push_retry.enabled).toBe(true);
      expect(result.push_retry.retries).toBe(3);
      expect(result.push_retry.min_delay_ms).toBe(100);
      expect(result.push_retry.max_delay_ms).toBe(1000);
      expect(result.push_retry.jitter).toBe(true);
    });

    it('should validate push_retry constraints', async () => {
      const { GitConfigSchema } = await import('../lumenflow-config-schema.js');

      // Test invalid retries (negative)
      const result = GitConfigSchema.safeParse({
        push_retry: {
          retries: -1,
        },
      });

      expect(result.success).toBe(false);
    });
  });
});
