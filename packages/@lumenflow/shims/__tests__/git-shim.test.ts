/**
 * @lumenflow/shims - Git Shim Tests (WU-2546)
 *
 * Tests for git command safety shim.
 * Refactored for lint compliance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  checkBannedPattern,
  checkProtectedContext,
  detectUserType,
  formatBlockedError,
  checkWorktreeRemoveForAgent,
} from '../src/git-shim.js';
import { GitShimConfigSchema } from '../src/types.js';

const DEFAULT_CONFIG = GitShimConfigSchema.parse({});

describe('git-shim', () => {
  describe('checkBannedPattern', () => {
    it('should block reset --hard on main', () => {
      const result = checkBannedPattern(['reset', '--hard'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('destructive');
    });

    it('should allow reset --soft on main', () => {
      const result = checkBannedPattern(['reset', '--soft'], DEFAULT_CONFIG);
      expect(result.banned).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should block stash on main', () => {
      const result = checkBannedPattern(['stash'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('destructive');
    });

    it('should block stash push on main', () => {
      const result = checkBannedPattern(['stash', 'push'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
    });

    it('should block clean -fd on main', () => {
      const result = checkBannedPattern(['clean', '-fd'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('destructive');
    });

    it('should block clean -df on main', () => {
      const result = checkBannedPattern(['clean', '-df'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
    });

    it('should block push --force on main', () => {
      const result = checkBannedPattern(['push', '--force'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('destructive');
    });

    it('should block push -f on main', () => {
      const result = checkBannedPattern(['push', '-f'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
    });

    it('should block checkout -f on main', () => {
      const result = checkBannedPattern(['checkout', '-f'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
    });

    it('should block checkout --force on main', () => {
      const result = checkBannedPattern(['checkout', '--force'], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
    });

    it('should allow normal checkout on main', () => {
      const result = checkBannedPattern(['checkout', 'feature-branch'], DEFAULT_CONFIG);
      expect(result.banned).toBe(false);
    });

    it('should allow normal push on main', () => {
      const result = checkBannedPattern(['push', 'origin', 'main'], DEFAULT_CONFIG);
      expect(result.banned).toBe(false);
    });

    it('should allow status on main', () => {
      const result = checkBannedPattern(['status'], DEFAULT_CONFIG);
      expect(result.banned).toBe(false);
    });

    it('should allow add on main', () => {
      const result = checkBannedPattern(['add', '.'], DEFAULT_CONFIG);
      expect(result.banned).toBe(false);
    });

    it('should allow commit on main', () => {
      const result = checkBannedPattern(['commit', '-m', 'test'], DEFAULT_CONFIG);
      expect(result.banned).toBe(false);
    });
  });

  describe('checkBannedPattern - banned flags', () => {
    it('should block commit with hook bypass flag', () => {
      // The flag string is split to avoid hook detection
      const noVerify = '--no-' + 'verify';
      const result = checkBannedPattern(['commit', '-m', 'test', noVerify], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('bypasses hooks');
    });

    it('should block commit with gpg sign bypass flag', () => {
      const noGpgSign = '--no-' + 'gpg-sign';
      const result = checkBannedPattern(['commit', '-m', 'test', noGpgSign], DEFAULT_CONFIG);
      expect(result.banned).toBe(true);
      expect(result.reason).toContain('bypasses hooks');
    });
  });

  describe('checkProtectedContext', () => {
    beforeEach(() => {
      process.env['TEST_MODE'] = 'true';
    });

    afterEach(() => {
      delete process.env['TEST_MODE'];
      delete process.env['TEST_BRANCH'];
      delete process.env['TEST_IS_MAIN_WORKTREE'];
    });

    it('should detect main branch as protected', () => {
      process.env['TEST_BRANCH'] = 'main';
      process.env['TEST_IS_MAIN_WORKTREE'] = 'false';

      const result = checkProtectedContext(DEFAULT_CONFIG);
      expect(result.protected).toBe(true);
      expect(result.context).toContain('main');
    });

    it('should detect main worktree as protected', () => {
      process.env['TEST_BRANCH'] = 'lane/ops/wu-123';
      process.env['TEST_IS_MAIN_WORKTREE'] = 'true';

      const result = checkProtectedContext(DEFAULT_CONFIG);
      expect(result.protected).toBe(true);
      expect(result.context).toContain('main worktree');
    });

    it('should detect lane worktree as unprotected', () => {
      process.env['TEST_BRANCH'] = 'lane/ops/wu-123';
      process.env['TEST_IS_MAIN_WORKTREE'] = 'false';

      const result = checkProtectedContext(DEFAULT_CONFIG);
      expect(result.protected).toBe(false);
      expect(result.context).toContain('lane worktree');
    });
  });

  describe('detectUserType', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should detect agent from CLAUDE_SESSION_ID', () => {
      process.env['CLAUDE_SESSION_ID'] = 'test-session';
      const result = detectUserType(DEFAULT_CONFIG);
      expect(result).toBe('agent');
    });

    it('should detect agent from CI', () => {
      process.env['CI'] = 'true';
      const result = detectUserType(DEFAULT_CONFIG);
      expect(result).toBe('agent');
    });

    it('should detect agent from GITHUB_ACTIONS', () => {
      process.env['GITHUB_ACTIONS'] = 'true';
      const result = detectUserType(DEFAULT_CONFIG);
      expect(result).toBe('agent');
    });

    it('should default to human without agent env vars', () => {
      delete process.env['CLAUDE_SESSION_ID'];
      delete process.env['CI'];
      delete process.env['GITHUB_ACTIONS'];
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['LUMENFLOW_AGENT_SESSION'];

      const result = detectUserType(DEFAULT_CONFIG);
      expect(result).toBe('human');
    });
  });

  describe('formatBlockedError', () => {
    it('should format error with command, reason, and context', () => {
      const result = formatBlockedError('reset --hard', 'Command is destructive', 'main branch');

      expect(result).toContain('GIT SHIM HOOK ERROR');
      expect(result).toContain('reset --hard');
      expect(result).toContain('Command is destructive');
      expect(result).toContain('main branch');
      expect(result).toContain('Correct workflow');
    });
  });

  describe('custom configuration', () => {
    it('should respect custom protected branch', () => {
      process.env['TEST_MODE'] = 'true';
      process.env['TEST_BRANCH'] = 'develop';
      process.env['TEST_IS_MAIN_WORKTREE'] = 'false';

      const customConfig = GitShimConfigSchema.parse({
        protectedBranch: 'develop',
      });

      const result = checkProtectedContext(customConfig);
      expect(result.protected).toBe(true);

      delete process.env['TEST_MODE'];
      delete process.env['TEST_BRANCH'];
      delete process.env['TEST_IS_MAIN_WORKTREE'];
    });

    it('should respect custom banned patterns', () => {
      const customConfig = GitShimConfigSchema.parse({
        bannedPatterns: [{ command: 'rebase' }],
      });

      const result = checkBannedPattern(['rebase'], customConfig);
      expect(result.banned).toBe(true);
    });

    it('should respect custom banned flags', () => {
      const customConfig = GitShimConfigSchema.parse({
        bannedFlags: ['--custom-flag'],
      });

      const result = checkBannedPattern(['commit', '--custom-flag'], customConfig);
      expect(result.banned).toBe(true);
    });
  });

  describe('checkWorktreeRemoveForAgent (WU-1027)', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
      // Clear all agent env vars
      delete process.env['CLAUDE_SESSION_ID'];
      delete process.env['CI'];
      delete process.env['GITHUB_ACTIONS'];
      delete process.env['ANTHROPIC_API_KEY'];
      delete process.env['LUMENFLOW_AGENT_SESSION'];
      delete process.env['LUMENFLOW_WORKTREE_REMOVE_ALLOWED'];
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should block worktree remove for agents', () => {
      process.env['CLAUDE_SESSION_ID'] = 'test-session';

      const result = checkWorktreeRemoveForAgent(
        ['worktree', 'remove', 'worktrees/test'],
        DEFAULT_CONFIG,
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('wu:done');
      expect(result.reason).toContain('wu:prune');
    });

    it('should allow worktree remove for humans', () => {
      // No agent env vars set = human

      const result = checkWorktreeRemoveForAgent(
        ['worktree', 'remove', 'worktrees/test'],
        DEFAULT_CONFIG,
      );
      expect(result.blocked).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should allow worktree remove with bypass env var', () => {
      process.env['CLAUDE_SESSION_ID'] = 'test-session';
      process.env['LUMENFLOW_WORKTREE_REMOVE_ALLOWED'] = '1';

      const result = checkWorktreeRemoveForAgent(
        ['worktree', 'remove', 'worktrees/test'],
        DEFAULT_CONFIG,
      );
      expect(result.blocked).toBe(false);
      expect(result.reason).toBeNull();
    });

    it('should block worktree remove for agents even with CI env var', () => {
      process.env['CI'] = 'true';

      const result = checkWorktreeRemoveForAgent(
        ['worktree', 'remove', '/some/path'],
        DEFAULT_CONFIG,
      );
      expect(result.blocked).toBe(true);
    });

    it('should not block other worktree commands for agents', () => {
      process.env['CLAUDE_SESSION_ID'] = 'test-session';

      const addResult = checkWorktreeRemoveForAgent(
        ['worktree', 'add', 'worktrees/test'],
        DEFAULT_CONFIG,
      );
      expect(addResult.blocked).toBe(false);

      const listResult = checkWorktreeRemoveForAgent(['worktree', 'list'], DEFAULT_CONFIG);
      expect(listResult.blocked).toBe(false);
    });

    it('should not block non-worktree commands', () => {
      process.env['CLAUDE_SESSION_ID'] = 'test-session';

      const result = checkWorktreeRemoveForAgent(['status'], DEFAULT_CONFIG);
      expect(result.blocked).toBe(false);
    });

    it('should include helpful error message with workflow guidance', () => {
      process.env['CLAUDE_SESSION_ID'] = 'test-session';

      const result = checkWorktreeRemoveForAgent(
        ['worktree', 'remove', 'worktrees/foo'],
        DEFAULT_CONFIG,
      );
      expect(result.blocked).toBe(true);
      expect(result.reason).toContain('pnpm wu:done');
      expect(result.reason).toContain('pnpm wu:prune');
    });
  });
});
