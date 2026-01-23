/**
 * Tests for micro-worktree operations
 *
 * WU-1081: Tests for LUMENFLOW_FORCE environment variable handling
 * during push-only mode in withMicroWorktree.
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
});
