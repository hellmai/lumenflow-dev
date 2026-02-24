// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file dirty-guard.test.ts
 * Tests for the dirty-guard sub-module (WU-2127)
 */

import { describe, it, expect } from 'vitest';
import { evaluateMainDirtyMutationGuard } from '../../hooks/dirty-guard.js';
import type {
  MainDirtyMutationGuardOptions,
  MainDirtyMutationGuardResult,
} from '../../hooks/dirty-guard.js';

describe('WU-2127: dirty-guard sub-module', () => {
  const BASE_OPTIONS: MainDirtyMutationGuardOptions = {
    commandName: 'wu:prep',
    mainCheckout: '/test/project',
    mainStatus: '',
    hasActiveWorktreeContext: true,
    isBranchPrMode: false,
  };

  describe('evaluateMainDirtyMutationGuard', () => {
    it('should not block in branch-pr mode', () => {
      const result: MainDirtyMutationGuardResult = evaluateMainDirtyMutationGuard({
        ...BASE_OPTIONS,
        mainStatus: ' M packages/cli/src/file.ts',
        isBranchPrMode: true,
      });
      expect(result.blocked).toBe(false);
      expect(result.reason).toBe('branch-pr-mode');
    });

    it('should not block when no active worktree context', () => {
      const result = evaluateMainDirtyMutationGuard({
        ...BASE_OPTIONS,
        mainStatus: ' M packages/cli/src/file.ts',
        hasActiveWorktreeContext: false,
      });
      expect(result.blocked).toBe(false);
      expect(result.reason).toBe('no-worktree-context');
    });

    it('should not block when main is clean', () => {
      const result = evaluateMainDirtyMutationGuard({
        ...BASE_OPTIONS,
        mainStatus: '',
      });
      expect(result.blocked).toBe(false);
      expect(result.reason).toBe('clean-or-allowlisted');
    });

    it('should not block when all dirty paths are allowlisted', () => {
      const result = evaluateMainDirtyMutationGuard({
        ...BASE_OPTIONS,
        mainStatus: ' M .lumenflow/state/events.jsonl\n M .claude/settings.json',
      });
      expect(result.blocked).toBe(false);
      expect(result.reason).toBe('clean-or-allowlisted');
    });

    it('should block when non-allowlisted dirty paths exist', () => {
      const result = evaluateMainDirtyMutationGuard({
        ...BASE_OPTIONS,
        mainStatus: ' M packages/cli/src/file.ts',
      });
      expect(result.blocked).toBe(true);
      expect(result.reason).toBe('blocked-non-allowlisted-dirty-main');
      expect(result.blockedPaths).toContain('packages/cli/src/file.ts');
      expect(result.message).toContain('wu:prep blocked');
    });

    it('should include detailed message with blocked paths', () => {
      const result = evaluateMainDirtyMutationGuard({
        ...BASE_OPTIONS,
        commandName: 'wu:done',
        mainStatus: ' M src/a.ts\n M src/b.ts',
      });
      expect(result.blocked).toBe(true);
      expect(result.message).toContain('wu:done blocked');
      expect(result.message).toContain('src/a.ts');
      expect(result.message).toContain('src/b.ts');
    });

    it('should export types for external consumption', () => {
      // Type assertion test: ensure the interface types are exported correctly
      const opts: MainDirtyMutationGuardOptions = {
        commandName: 'test',
        mainCheckout: '/test',
        mainStatus: '',
        hasActiveWorktreeContext: false,
        isBranchPrMode: false,
      };
      const result: MainDirtyMutationGuardResult = evaluateMainDirtyMutationGuard(opts);
      expect(result).toHaveProperty('blocked');
      expect(result).toHaveProperty('blockedPaths');
      expect(result).toHaveProperty('reason');
    });
  });
});
