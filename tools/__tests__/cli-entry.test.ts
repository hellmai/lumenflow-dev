/**
 * @file cli-entry.test.mjs
 * Test suite for cli-entry.mjs fallback behavior (WU-1366)
 *
 * WU-1366: spec:linter runs successfully in worktrees without built CLI
 *          by falling back to main CLI dist.
 *
 * Tests:
 * - selectCliEntryPath returns main repo CLI dist when worktree dist missing
 * - selectCliEntryPath returns worktree dist when it exists
 * - ensureCliDist tries main repo fallback before attempting build
 * - Build is attempted only when both worktree and main dist are missing
 */

import { describe, it, expect, vi } from 'vitest';
import {
  selectCliEntryPath,
  resolveCliDistEntry,
  resolveMainRepoFromWorktree,
  ensureCliDist,
  runCliEntry,
  parseSimpleConfig,
  getBuildCommand,
} from '../cli-entry.mjs';

describe('cli-entry.mjs fallback behavior (WU-1366)', () => {
  describe('resolveMainRepoFromWorktree', () => {
    it('should extract main repo path from worktree path', () => {
      const worktreePath = '/repo/worktrees/framework-cli-wu-123';
      const mainRepo = resolveMainRepoFromWorktree(worktreePath);
      expect(mainRepo).toBe('/repo');
    });

    it('should return null for non-worktree paths', () => {
      const mainPath = '/repo';
      const result = resolveMainRepoFromWorktree(mainPath);
      expect(result).toBeNull();
    });

    it('should handle nested worktree paths', () => {
      const deepPath = '/repo/worktrees/lane-wu-456/some/deep/path';
      const mainRepo = resolveMainRepoFromWorktree(deepPath);
      expect(mainRepo).toBe('/repo');
    });
  });

  describe('selectCliEntryPath', () => {
    it('should return primary path when it exists', () => {
      const exists = vi.fn().mockReturnValue(true);
      const result = selectCliEntryPath({
        repoRoot: '/worktree',
        entry: 'gates',
        mainRepoPath: '/main',
        exists,
      });

      expect(result).toBe(resolveCliDistEntry('/worktree', 'gates'));
      expect(exists).toHaveBeenCalledTimes(1);
    });

    it('should return fallback path when primary does not exist', () => {
      const exists = vi.fn().mockImplementation((path) => {
        return path.includes('/main/');
      });

      const result = selectCliEntryPath({
        repoRoot: '/worktree',
        entry: 'gates',
        mainRepoPath: '/main',
        exists,
      });

      expect(result).toBe(resolveCliDistEntry('/main', 'gates'));
    });

    it('should return null when both paths do not exist', () => {
      const exists = vi.fn().mockReturnValue(false);
      const result = selectCliEntryPath({
        repoRoot: '/worktree',
        entry: 'gates',
        mainRepoPath: '/main',
        exists,
      });

      expect(result).toBeNull();
    });

    it('should return null when mainRepoPath is null and primary does not exist', () => {
      const exists = vi.fn().mockReturnValue(false);
      const result = selectCliEntryPath({
        repoRoot: '/worktree',
        entry: 'gates',
        mainRepoPath: null,
        exists,
      });

      expect(result).toBeNull();
    });
  });

  describe('ensureCliDist', () => {
    it('should return existing worktree dist without building', () => {
      const exists = vi.fn().mockReturnValue(true);
      const spawn = vi.fn();
      const logger = { log: vi.fn(), warn: vi.fn() };

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'gates',
        mainRepoPath: '/main',
        exists,
        spawn,
        logger,
      });

      expect(result.source).toBe('repo');
      expect(result.built).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should try main repo fallback before building when worktree dist missing', () => {
      // Primary (worktree) doesn't exist, but main repo does
      const exists = vi.fn().mockImplementation((path) => {
        return path.includes('/main/');
      });
      const spawn = vi.fn().mockReturnValue({ status: 1 }); // Would fail if called
      const logger = { log: vi.fn(), warn: vi.fn() };

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'gates',
        mainRepoPath: '/main',
        exists,
        spawn,
        logger,
      });

      // Should return main repo path WITHOUT attempting build
      expect(result.source).toBe('main');
      expect(result.path).toContain('/main/');
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('main repo'));
      // Critical: spawn should NOT be called since fallback was found first
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should attempt build when worktree dist missing and no main fallback', () => {
      const existsResults = {
        '/worktree/packages/@lumenflow/cli/dist/gates.js': false,
      };
      const exists = vi.fn().mockImplementation((path) => existsResults[path] === true);
      const spawn = vi.fn().mockReturnValue({ status: 0 });
      const logger = { log: vi.fn(), warn: vi.fn() };

      // After build succeeds, mark dist as existing
      spawn.mockImplementation(() => {
        existsResults['/worktree/packages/@lumenflow/cli/dist/gates.js'] = true;
        return { status: 0 };
      });

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'gates',
        mainRepoPath: null, // No main repo (not in worktree)
        exists,
        spawn,
        logger,
      });

      expect(spawn).toHaveBeenCalled();
      expect(result.built).toBe(true);
      expect(result.source).toBe('repo');
    });

    it('should return null when build fails and no fallback available', () => {
      const exists = vi.fn().mockReturnValue(false);
      const spawn = vi.fn().mockReturnValue({ status: 1 }); // Build fails
      const logger = { log: vi.fn(), warn: vi.fn() };

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'gates',
        mainRepoPath: null,
        exists,
        spawn,
        logger,
      });

      expect(result.path).toBeNull();
      expect(result.source).toBe('none');
    });
  });

  describe('runCliEntry', () => {
    it('should print bootstrap guidance when CLI dist cannot be located', () => {
      const spawn = vi
        .fn()
        // build attempt fails
        .mockReturnValueOnce({ status: 1 });
      const exit = vi.fn();
      const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

      runCliEntry({
        entry: 'wu-prep',
        args: ['--id', 'WU-1487'],
        cwd: '/repo/worktrees/framework-cli-wu-1487',
        spawn,
        exit,
        logger,
      });

      const output = logger.error.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(output).toContain('Unable to locate CLI dist for wu-prep');
      expect(output).toContain('pnpm bootstrap');
      expect(exit).toHaveBeenCalled();
    });
  });

  describe('parseSimpleConfig', () => {
    it('should parse package_manager from YAML', () => {
      const yaml = 'package_manager: npm\nbuild_command: npm run build';
      const result = parseSimpleConfig(yaml);
      expect(result.packageManager).toBe('npm');
    });

    it('should parse build_command from YAML', () => {
      const yaml = 'package_manager: pnpm\nbuild_command: pnpm build:cli';
      const result = parseSimpleConfig(yaml);
      expect(result.buildCommand).toBe('pnpm build:cli');
    });

    it('should return empty object for invalid YAML', () => {
      const yaml = 'not valid yaml content';
      const result = parseSimpleConfig(yaml);
      expect(result.packageManager).toBeUndefined();
      expect(result.buildCommand).toBeUndefined();
    });

    it('should reject invalid package manager values', () => {
      const yaml = 'package_manager: invalid';
      const result = parseSimpleConfig(yaml);
      expect(result.packageManager).toBeUndefined();
    });
  });

  describe('getBuildCommand', () => {
    it('should return default pnpm command when no config file', () => {
      const result = getBuildCommand('/non/existent/path');
      expect(result.command).toBe('pnpm');
      expect(result.args).toContain('build');
    });
  });
});
