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

// Test constants to satisfy sonarjs/no-duplicate-string
const TEST_REMOTE = 'origin';
const TEST_BRANCH = 'main';
const TEST_TEMP_BRANCH = 'tmp/wu-create/wu-123';
const TEST_LOG_PREFIX = '[test]';
const ORIGINAL_FORCE = 'original-force';
const ORIGINAL_REASON = 'original-reason';
const NON_FAST_FORWARD_ERROR = 'rejected: non-fast-forward';
const HARD_RESET_OPTION = { hard: true };
const FF_ONLY_OPTION = { ffOnly: true };
const ORIGIN_MAIN_REF = 'origin/main';

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
      // eslint-disable-next-line sonarjs/deprecation -- Testing deprecated export for backwards compat
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

      // Rollback should happen: reset local main to origin/main
      expect(mockMainGit.reset).toHaveBeenCalledWith(ORIGIN_MAIN_REF, HARD_RESET_OPTION);

      // Fetch origin/main
      expect(mockMainGit.fetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);

      // Update local main via ff-only merge
      expect(mockMainGit.merge).toHaveBeenCalledWith(ORIGIN_MAIN_REF, FF_ONLY_OPTION);

      // Rebase temp branch on updated main
      expect(mockWorktreeGit.rebase).toHaveBeenCalledWith(TEST_BRANCH);
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

      // Rollback should happen MAX_PUSH_RETRIES - 1 times (not on last failure)
      expect(mockMainGit.reset).toHaveBeenCalledTimes(expectedRetries - 1);
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
        TEST_REMOTE,
        TEST_BRANCH,
        TEST_TEMP_BRANCH,
        TEST_LOG_PREFIX,
      );

      // Key acceptance criterion: rollback local main to origin/main
      expect(mockMainGit.reset).toHaveBeenCalledWith(ORIGIN_MAIN_REF, HARD_RESET_OPTION);
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

      // Verify that fetch was called with origin and main BEFORE any other operations
      expect(mockFetch).toHaveBeenCalledWith(TEST_REMOTE, TEST_BRANCH);

      // Fetch should be called before createBranchNoCheckout (the first real operation)
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
        retries: 3,
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
        retries: 3,
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
        expect.fail('Should have thrown');
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
        retries: 3,
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
        retries: 3,
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
