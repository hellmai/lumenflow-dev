/**
 * WorktreeGuard tests (WU-2537)
 */

import { describe, it, expect } from 'vitest';
import { WorktreeGuard } from '../../src/lib/worktree-guard.js';

describe('WorktreeGuard', () => {
  describe('isInWorktree', () => {
    it('returns true when path contains worktrees/', async () => {
      const guard = new WorktreeGuard('/home/user/project/worktrees/lane-wu-123');
      expect(await guard.isInWorktree()).toBe(true);
    });

    it('returns false when not in worktree', async () => {
      const guard = new WorktreeGuard('/home/user/project');
      expect(await guard.isInWorktree()).toBe(false);
    });
  });

  describe('getCurrentWorktreePath', () => {
    it('returns path when in worktree', async () => {
      const path = '/home/user/project/worktrees/operations-wu-456';
      const guard = new WorktreeGuard(path);
      expect(await guard.getCurrentWorktreePath()).toBe(path);
    });

    it('returns null when not in worktree', async () => {
      const guard = new WorktreeGuard('/home/user/project');
      expect(await guard.getCurrentWorktreePath()).toBeNull();
    });
  });

  describe('assertInWorktree', () => {
    it('does not throw when in worktree', async () => {
      const guard = new WorktreeGuard('/home/user/project/worktrees/lane-wu-789');
      await expect(guard.assertInWorktree()).resolves.not.toThrow();
    });

    it('throws when not in worktree', async () => {
      const guard = new WorktreeGuard('/home/user/project');
      await expect(guard.assertInWorktree()).rejects.toThrow(
        'Operation requires worktree context'
      );
    });
  });

  describe('getWorktreeWuId', () => {
    it('extracts WU ID from worktree path', () => {
      const guard = new WorktreeGuard('/home/user/project/worktrees/operations-wu-123');
      expect(guard.getWorktreeWuId()).toBe('WU-123');
    });

    it('handles complex lane names', () => {
      const guard = new WorktreeGuard('/home/user/project/worktrees/operations-workflow-engine-wu-2537');
      expect(guard.getWorktreeWuId()).toBe('WU-2537');
    });

    it('returns null when not in worktree', () => {
      const guard = new WorktreeGuard('/home/user/project');
      expect(guard.getWorktreeWuId()).toBeNull();
    });

    it('returns null for invalid worktree path', () => {
      const guard = new WorktreeGuard('/home/user/project/worktrees/invalid');
      expect(guard.getWorktreeWuId()).toBeNull();
    });
  });
});
