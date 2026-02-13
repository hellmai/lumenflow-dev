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
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  selectCliEntryPath,
  resolveCliDistEntry,
  resolveMainRepoFromWorktree,
  ensureCliDist,
  runCliEntry,
  maybeRunCliEntry,
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

    it('should force rebuild for strict lifecycle entries even when dist exists', () => {
      const exists = vi.fn().mockReturnValue(true);
      const spawn = vi.fn().mockReturnValue({ status: 0 });
      const logger = { log: vi.fn(), warn: vi.fn() };

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'wu-done',
        mainRepoPath: '/main',
        exists,
        spawn,
        logger,
      });

      expect(spawn).toHaveBeenCalled();
      expect(result.source).toBe('repo');
      expect(result.built).toBe(true);
    });

    it('should fall back to existing repo dist when strict build fails', () => {
      const exists = vi.fn().mockImplementation((path) => path.includes('/worktree/'));
      const spawn = vi.fn().mockReturnValue({ status: 1 });
      const logger = { log: vi.fn(), warn: vi.fn() };

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'wu-done',
        mainRepoPath: '/main',
        exists,
        spawn,
        logger,
      });

      expect(spawn).toHaveBeenCalled();
      expect(result.source).toBe('repo');
      expect(result.built).toBe(false);
      expect(result.path).toContain('/worktree/');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('falling back to existing CLI dist'),
      );
    });

    it('should fall back to main repo dist when strict build fails and worktree dist is missing', () => {
      const exists = vi.fn().mockImplementation((path) => path.includes('/main/'));
      const spawn = vi.fn().mockReturnValue({ status: 1 });
      const logger = { log: vi.fn(), warn: vi.fn() };

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'wu-claim',
        mainRepoPath: '/main',
        exists,
        spawn,
        logger,
      });

      expect(spawn).toHaveBeenCalled();
      expect(result.source).toBe('main');
      expect(result.built).toBe(false);
      expect(result.path).toContain('/main/');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('falling back to existing CLI dist'),
      );
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

    it('should return null for strict entries when build fails and no fallback dist exists', () => {
      const exists = vi.fn().mockReturnValue(false);
      const spawn = vi.fn().mockReturnValue({ status: 1 });
      const logger = { log: vi.fn(), warn: vi.fn() };

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'wu-done',
        mainRepoPath: null,
        exists,
        spawn,
        logger,
      });

      expect(spawn).toHaveBeenCalled();
      expect(result.path).toBeNull();
      expect(result.source).toBe('none');
    });

    it('should return null for strict entries when main repo path exists but dist is missing', () => {
      const exists = vi.fn().mockReturnValue(false);
      const spawn = vi.fn().mockReturnValue({ status: 1 });
      const logger = { log: vi.fn(), warn: vi.fn() };

      const result = ensureCliDist({
        repoRoot: '/worktree',
        entry: 'wu-done',
        mainRepoPath: '/main',
        exists,
        spawn,
        logger,
      });

      expect(spawn).toHaveBeenCalled();
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

    it('should execute when invoked as a direct script with default entry', () => {
      const tempRepo = mkdtempSync(path.join(tmpdir(), 'cli-entry-direct-'));
      try {
        const distDir = path.join(tempRepo, 'packages', '@lumenflow', 'cli', 'dist');
        mkdirSync(distDir, { recursive: true });
        writeFileSync(path.join(distDir, 'gates.js'), 'process.exit(0);\n');

        const cliEntryPath = path.resolve(process.cwd(), 'tools/cli-entry.mjs');
        const result = spawnSync('node', [cliEntryPath], {
          cwd: tempRepo,
          encoding: 'utf8',
        });

        expect(result.status).toBe(0);
      } finally {
        rmSync(tempRepo, { recursive: true, force: true });
      }
    });

    it('should execute resolved CLI entry and exit with command status', () => {
      const tempRepo = mkdtempSync(path.join(tmpdir(), 'cli-entry-run-'));
      try {
        const distDir = path.join(tempRepo, 'packages', '@lumenflow', 'cli', 'dist');
        mkdirSync(distDir, { recursive: true });
        const distPath = path.join(distDir, 'gates.js');
        writeFileSync(distPath, 'process.exit(0);\n');

        const spawn = vi.fn().mockReturnValue({ status: 0 });
        const exit = vi.fn();
        const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

        runCliEntry({
          entry: 'gates',
          args: ['--verbose'],
          cwd: tempRepo,
          spawn,
          exit,
          logger,
        });

        expect(spawn).toHaveBeenCalledWith('node', [distPath, '--verbose'], {
          cwd: tempRepo,
          stdio: 'inherit',
        });
        expect(exit).toHaveBeenCalledWith(0);
      } finally {
        rmSync(tempRepo, { recursive: true, force: true });
      }
    });

    it('should default exit code to 1 when command status is undefined', () => {
      const tempRepo = mkdtempSync(path.join(tmpdir(), 'cli-entry-run-'));
      try {
        const distDir = path.join(tempRepo, 'packages', '@lumenflow', 'cli', 'dist');
        mkdirSync(distDir, { recursive: true });
        writeFileSync(path.join(distDir, 'gates.js'), 'process.exit(0);\n');

        const spawn = vi.fn().mockReturnValue({});
        const exit = vi.fn();
        const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

        runCliEntry({
          entry: 'gates',
          args: [],
          cwd: tempRepo,
          spawn,
          exit,
          logger,
        });

        expect(exit).toHaveBeenCalledWith(1);
      } finally {
        rmSync(tempRepo, { recursive: true, force: true });
      }
    });
  });

  describe('maybeRunCliEntry', () => {
    it('should return true and execute run when argv indicates direct script execution', () => {
      const run = vi.fn();
      const argv = ['/usr/bin/node', '/repo/tools/cli-entry.mjs', 'wu-claim', '--id', 'WU-1'];
      const moduleUrl = pathToFileURL('/repo/tools/cli-entry.mjs').href;

      const didRun = maybeRunCliEntry({ argv, moduleUrl, run });

      expect(didRun).toBe(true);
      expect(run).toHaveBeenCalledWith({ entry: 'wu-claim', args: ['--id', 'WU-1'] });
    });

    it('should return false and not execute run for non-direct imports', () => {
      const run = vi.fn();
      const argv = ['/usr/bin/node', '/repo/other-script.mjs'];
      const moduleUrl = pathToFileURL('/repo/tools/cli-entry.mjs').href;

      const didRun = maybeRunCliEntry({ argv, moduleUrl, run });

      expect(didRun).toBe(false);
      expect(run).not.toHaveBeenCalled();
    });

    it('should handle missing argv[1] when checking direct execution', () => {
      const run = vi.fn();
      const argv = ['/usr/bin/node'];
      const moduleUrl = pathToFileURL('/repo/tools/cli-entry.mjs').href;

      const didRun = maybeRunCliEntry({ argv, moduleUrl, run });

      expect(didRun).toBe(false);
      expect(run).not.toHaveBeenCalled();
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

    it('should use package_manager defaults when config exists without custom build_command', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'cli-entry-test-'));
      try {
        writeFileSync(path.join(dir, '.lumenflow.config.yaml'), "package_manager: npm\n");
        const result = getBuildCommand(dir);
        expect(result.command).toBe('npm');
        expect(result.args).toEqual(['run', 'build', '--', '--filter=@lumenflow/cli']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should use custom build_command from config when provided', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'cli-entry-test-'));
      try {
        writeFileSync(
          path.join(dir, '.lumenflow.config.yaml'),
          "package_manager: pnpm\nbuild_command: 'pnpm build:dist'\n",
        );
        const result = getBuildCommand(dir);
        expect(result.command).toBe('pnpm');
        expect(result.args).toEqual(['build:dist']);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('should fall back to pnpm defaults when config has invalid package_manager', () => {
      const dir = mkdtempSync(path.join(tmpdir(), 'cli-entry-test-'));
      try {
        writeFileSync(path.join(dir, '.lumenflow.config.yaml'), "package_manager: invalid\n");
        const result = getBuildCommand(dir);
        expect(result.command).toBe('pnpm');
        expect(result.args).toContain('build');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
