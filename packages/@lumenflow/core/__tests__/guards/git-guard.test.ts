/**
 * Git Guard Tests (WU-2539)
 *
 * Tests for git command protection on main branch.
 * Blocks destructive operations like reset --hard, stash, clean -fd.
 *
 * TDD: Tests written before implementation.
 */

import { describe, it, expect } from 'vitest';
import {
  checkBannedPattern,
  checkProtectedContext,
  type BannedCheckResult,
  type ProtectedContext,
} from '../../src/guards/git-guard.js';

describe('Git Guard', () => {
  describe('checkBannedPattern', () => {
    it('blocks git reset --hard', () => {
      const result = checkBannedPattern(['reset', '--hard']);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('destructive');
    });

    it('blocks git stash', () => {
      const result = checkBannedPattern(['stash']);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('destructive');
    });

    it('blocks git stash pop', () => {
      const result = checkBannedPattern(['stash', 'pop']);
      expect(result.banned).toBe(true);
    });

    it('blocks git clean -fd', () => {
      const result = checkBannedPattern(['clean', '-fd']);
      expect(result.banned).toBe(true);
    });

    it('blocks git clean -df', () => {
      const result = checkBannedPattern(['clean', '-df']);
      expect(result.banned).toBe(true);
    });

    it('blocks git checkout -f', () => {
      const result = checkBannedPattern(['checkout', '-f']);
      expect(result.banned).toBe(true);
    });

    it('blocks git checkout --force', () => {
      const result = checkBannedPattern(['checkout', '--force']);
      expect(result.banned).toBe(true);
    });

    it('blocks git push --force', () => {
      const result = checkBannedPattern(['push', '--force']);
      expect(result.banned).toBe(true);
    });

    it('blocks git push -f', () => {
      const result = checkBannedPattern(['push', '-f']);
      expect(result.banned).toBe(true);
    });

    it('blocks --no-verify flag on any command', () => {
      const result = checkBannedPattern(['commit', '-m', 'test', '--no-verify']);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('bypasses hooks');
    });

    it('blocks --no-gpg-sign flag on any command', () => {
      const result = checkBannedPattern(['commit', '-m', 'test', '--no-gpg-sign']);
      expect(result.banned).toBe(true);
    });

    it('allows git status', () => {
      const result = checkBannedPattern(['status']);
      expect(result.banned).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('allows git add', () => {
      const result = checkBannedPattern(['add', '.']);
      expect(result.banned).toBe(false);
    });

    it('allows git commit without bypass flags', () => {
      const result = checkBannedPattern(['commit', '-m', 'test message']);
      expect(result.banned).toBe(false);
    });

    it('allows git push without force', () => {
      const result = checkBannedPattern(['push', 'origin', 'main']);
      expect(result.banned).toBe(false);
    });

    it('allows git reset without --hard', () => {
      const result = checkBannedPattern(['reset', 'HEAD~1']);
      expect(result.banned).toBe(false);
    });

    it('handles case insensitivity', () => {
      const result = checkBannedPattern(['RESET', '--HARD']);
      expect(result.banned).toBe(true);
    });

    it('handles empty args', () => {
      const result = checkBannedPattern([]);
      expect(result.banned).toBe(false);
    });
  });

  describe('checkProtectedContext', () => {
    it('identifies main branch as protected', () => {
      const result = checkProtectedContext({
        branch: 'main',
        isMainWorktree: false,
      });
      expect(result.protected).toBe(true);
      expect(result.context).toContain('main');
    });

    it('identifies main worktree as protected', () => {
      const result = checkProtectedContext({
        branch: 'lane/operations/wu-123',
        isMainWorktree: true,
      });
      expect(result.protected).toBe(true);
      expect(result.context).toContain('worktree');
    });

    it('identifies lane branch in worktree as unprotected', () => {
      const result = checkProtectedContext({
        branch: 'lane/operations/wu-123',
        isMainWorktree: false,
      });
      expect(result.protected).toBe(false);
      expect(result.context).toContain('lane');
    });
  });
});
