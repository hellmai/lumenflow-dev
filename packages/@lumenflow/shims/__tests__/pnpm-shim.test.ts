/**
 * @lumenflow/shims - Pnpm Shim Tests (WU-2546)
 *
 * Tests for pnpm worktree compatibility shim.
 */

import { describe, it, expect } from 'vitest';
import { isDependencyCommand } from '../src/pnpm-shim.js';
import { PnpmShimConfigSchema } from '../src/types.js';
import { isInWorktree, isMainWorktree, getMainCheckoutPath } from '../src/worktree.js';

const DEFAULT_CONFIG = PnpmShimConfigSchema.parse({});

describe('pnpm-shim', () => {
  describe('isDependencyCommand', () => {
    it('should detect add as dependency command', () => {
      const result = isDependencyCommand(['add', 'zod'], DEFAULT_CONFIG);
      expect(result).toBe(true);
    });

    it('should detect install as dependency command', () => {
      const result = isDependencyCommand(['install'], DEFAULT_CONFIG);
      expect(result).toBe(true);
    });

    it('should detect i as dependency command (alias)', () => {
      const result = isDependencyCommand(['i'], DEFAULT_CONFIG);
      expect(result).toBe(true);
    });

    it('should detect remove as dependency command', () => {
      const result = isDependencyCommand(['remove', 'zod'], DEFAULT_CONFIG);
      expect(result).toBe(true);
    });

    it('should detect rm as dependency command (alias)', () => {
      const result = isDependencyCommand(['rm', 'zod'], DEFAULT_CONFIG);
      expect(result).toBe(true);
    });

    it('should detect update as dependency command', () => {
      const result = isDependencyCommand(['update'], DEFAULT_CONFIG);
      expect(result).toBe(true);
    });

    it('should detect up as dependency command (alias)', () => {
      const result = isDependencyCommand(['up'], DEFAULT_CONFIG);
      expect(result).toBe(true);
    });

    it('should not detect run as dependency command', () => {
      const result = isDependencyCommand(['run', 'test'], DEFAULT_CONFIG);
      expect(result).toBe(false);
    });

    it('should not detect test as dependency command', () => {
      const result = isDependencyCommand(['test'], DEFAULT_CONFIG);
      expect(result).toBe(false);
    });

    it('should not detect exec as dependency command', () => {
      const result = isDependencyCommand(['exec', 'vitest'], DEFAULT_CONFIG);
      expect(result).toBe(false);
    });

    it('should not detect build as dependency command', () => {
      const result = isDependencyCommand(['build'], DEFAULT_CONFIG);
      expect(result).toBe(false);
    });

    it('should handle case insensitivity', () => {
      const result = isDependencyCommand(['ADD', 'zod'], DEFAULT_CONFIG);
      expect(result).toBe(true);
    });
  });

  describe('isInWorktree', () => {
    // These tests verify the function signature and basic behavior
    // Actual git operations depend on the current repo state
    it('should return a boolean', () => {
      const result = isInWorktree();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('isMainWorktree', () => {
    it('should return a boolean', () => {
      const result = isMainWorktree();
      expect(typeof result).toBe('boolean');
    });

    // When not in a worktree, isMainWorktree returns true
    // When in a worktree, isInWorktree returns true and isMainWorktree returns false
    it('should be logically consistent with isInWorktree', () => {
      const inWorktree = isInWorktree();
      const mainWorktree = isMainWorktree();

      // If in worktree, should not be main worktree
      // If main worktree, should not be in worktree
      if (inWorktree) {
        expect(mainWorktree).toBe(false);
      }
    });
  });

  describe('getMainCheckoutPath', () => {
    it('should return a string or null', () => {
      const result = getMainCheckoutPath();
      expect(result === null || typeof result === 'string').toBe(true);
    });

    it('should return non-null in a git repository', () => {
      // This test runs from within a git repo, so should return a path
      const result = getMainCheckoutPath();
      expect(result).not.toBeNull();
    });

    it('should return an absolute path', () => {
      const result = getMainCheckoutPath();
      if (result) {
        expect(result.startsWith('/')).toBe(true);
      }
    });
  });

  describe('custom configuration', () => {
    it('should respect custom dependency commands', () => {
      const customConfig = PnpmShimConfigSchema.parse({
        dependencyCommands: ['custom-cmd'],
      });

      expect(isDependencyCommand(['custom-cmd'], customConfig)).toBe(true);
      expect(isDependencyCommand(['add'], customConfig)).toBe(false);
    });
  });
});
