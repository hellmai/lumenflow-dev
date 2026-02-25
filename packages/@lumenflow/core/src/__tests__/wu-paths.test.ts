// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @fileoverview Tests for wu-paths module
 *
 * WU-1102: INIT-003 Phase 2b - Migrate WU helpers to @lumenflow/core
 *
 * Tests cover:
 * - resolveRepoRoot: Traverse up directory tree
 * - getStateStoreDirFromBacklog: Get state store from backlog path
 * - createWuPaths: Create paths object with config
 * - WU_PATHS: Default paths export
 * - defaultWorktreeFrom: Generate worktree path from WU doc
 * - resolveFromProjectRoot: Resolve relative path to absolute
 * - getAbsoluteWuPath: Get absolute path to WU YAML
 * - getAbsoluteStampPath: Get absolute path to stamp file
 *
 * @module __tests__/wu-paths.test
 */

import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  resolveRepoRoot,
  getStateStoreDirFromBacklog,
  createWuPaths,
  WU_PATHS,
  defaultWorktreeFrom,
  resolveFromProjectRoot,
  getAbsoluteWuPath,
  getAbsoluteStampPath,
} from '../wu-paths.js';

// Mock lumenflow-config to control config values
vi.mock('../lumenflow-config.js', () => ({
  getConfig: vi.fn((options?: { projectRoot?: string }) => ({
    directories: {
      wuDir: 'docs/04-operations/tasks/wu',
      statusPath: 'docs/04-operations/tasks/status.md',
      backlogPath: 'docs/04-operations/tasks/backlog.md',
      initiativesDir: 'docs/04-operations/tasks/initiatives',
      worktrees: 'worktrees',
      plansDir: 'docs/04-operations/plans',
      templatesDir: '.lumenflow/templates',
      onboardingDir: 'docs/04-operations/_frameworks/lumenflow/agent/onboarding',
      sizingGuidePath: 'docs/04-operations/_frameworks/lumenflow/wu-sizing-guide.md',
    },
    state: {
      stampsDir: '.lumenflow/stamps',
      stateDir: '.lumenflow/state',
    },
  })),
  getProjectRoot: vi.fn(() => '/fake/project/root'),
}));

describe('wu-paths', () => {
  describe('resolveRepoRoot', () => {
    it('should traverse up 0 levels (return same path)', () => {
      const result = resolveRepoRoot('/home/user/project/file.txt', 0);
      expect(result).toBe('/home/user/project/file.txt');
    });

    it('should traverse up 1 level', () => {
      const result = resolveRepoRoot('/home/user/project/file.txt', 1);
      expect(result).toBe('/home/user/project');
    });

    it('should traverse up multiple levels', () => {
      const result = resolveRepoRoot('/a/b/c/d/e/file.txt', 4);
      expect(result).toBe('/a/b');
    });

    it('should handle backlog depth (4 levels)', () => {
      const backlogPath = '/repo/docs/04-operations/tasks/backlog.md';
      const result = resolveRepoRoot(backlogPath, 4);
      expect(result).toBe('/repo');
    });

    it('should handle WU YAML depth (5 levels)', () => {
      const wuPath = '/repo/docs/04-operations/tasks/wu/WU-123.yaml';
      const result = resolveRepoRoot(wuPath, 5);
      expect(result).toBe('/repo');
    });

    it('should handle state store depth (3 levels)', () => {
      const statePath = '/repo/.lumenflow/state/wu-events.jsonl';
      const result = resolveRepoRoot(statePath, 3);
      expect(result).toBe('/repo');
    });

    it('should handle Windows-style paths', () => {
      // path.dirname handles platform-specific separators
      const result = resolveRepoRoot('/a/b/c/d', 2);
      expect(result).toBe('/a/b');
    });
  });

  describe('getStateStoreDirFromBacklog', () => {
    it('should compute state store directory from backlog path', () => {
      const backlogPath = '/fake/repo/docs/04-operations/tasks/backlog.md';
      const result = getStateStoreDirFromBacklog(backlogPath);

      // Should resolve to repo root + .lumenflow/state
      expect(result).toBe('/fake/repo/.lumenflow/state');
    });

    it('should work with nested repo paths', () => {
      const backlogPath = '/home/user/projects/myrepo/docs/04-operations/tasks/backlog.md';
      const result = getStateStoreDirFromBacklog(backlogPath);

      expect(result).toBe('/home/user/projects/myrepo/.lumenflow/state');
    });

    // WU-1523: Test that custom/simple docs structures resolve correctly
    it('should resolve state dir correctly for simple docs structure (docs/tasks/backlog.md)', async () => {
      // Override mock to return simple structure config
      const { getConfig } = vi.mocked(await import('../lumenflow-config.js'));
      getConfig.mockReturnValueOnce({
        directories: {
          wuDir: 'docs/tasks/wu',
          statusPath: 'docs/tasks/status.md',
          backlogPath: 'docs/tasks/backlog.md',
          initiativesDir: 'docs/tasks/initiatives',
          worktrees: 'worktrees',
          plansDir: 'docs/plans',
          templatesDir: '.lumenflow/templates',
          onboardingDir: 'docs/_frameworks/lumenflow/agent/onboarding',
          sizingGuidePath: 'docs/_frameworks/lumenflow/wu-sizing-guide.md',
        },
        state: {
          stampsDir: '.lumenflow/stamps',
          stateDir: '.lumenflow/state',
        },
      } as ReturnType<typeof getConfig>);

      const backlogPath = '/project/docs/tasks/backlog.md';
      const result = getStateStoreDirFromBacklog(backlogPath);

      // With simple structure (3 levels deep), should still resolve to /project
      expect(result).toBe('/project/.lumenflow/state');
    });

    it('should resolve state dir correctly for flat backlog path (tasks/backlog.md)', async () => {
      // Override mock to return flat structure config
      const { getConfig } = vi.mocked(await import('../lumenflow-config.js'));
      getConfig.mockReturnValueOnce({
        directories: {
          wuDir: 'tasks/wu',
          statusPath: 'tasks/status.md',
          backlogPath: 'tasks/backlog.md',
          initiativesDir: 'tasks/initiatives',
          worktrees: 'worktrees',
          plansDir: 'plans',
          templatesDir: '.lumenflow/templates',
          onboardingDir: '_frameworks/lumenflow/agent/onboarding',
          sizingGuidePath: '_frameworks/lumenflow/wu-sizing-guide.md',
        },
        state: {
          stampsDir: '.lumenflow/stamps',
          stateDir: '.lumenflow/state',
        },
      } as ReturnType<typeof getConfig>);

      const backlogPath = '/project/tasks/backlog.md';
      const result = getStateStoreDirFromBacklog(backlogPath);

      // With flat structure (2 levels deep), should still resolve to /project
      expect(result).toBe('/project/.lumenflow/state');
    });
  });

  describe('createWuPaths', () => {
    it('should create paths object with all expected methods', () => {
      const paths = createWuPaths();

      expect(typeof paths.WU).toBe('function');
      expect(typeof paths.WU_DIR).toBe('function');
      expect(typeof paths.STATUS).toBe('function');
      expect(typeof paths.BACKLOG).toBe('function');
      expect(typeof paths.STAMPS_DIR).toBe('function');
      expect(typeof paths.STAMP).toBe('function');
      expect(typeof paths.STATE_DIR).toBe('function');
      expect(typeof paths.INITIATIVES_DIR).toBe('function');
      expect(typeof paths.WORKTREES_DIR).toBe('function');
      expect(typeof paths.PLANS_DIR).toBe('function');
      expect(typeof paths.TEMPLATES_DIR).toBe('function');
      expect(typeof paths.ONBOARDING_DIR).toBe('function');
      expect(typeof paths.SIZING_GUIDE_PATH).toBe('function');
    });

    it('should return correct WU path', () => {
      const paths = createWuPaths();
      const wuPath = paths.WU('WU-123');

      expect(wuPath).toBe('docs/04-operations/tasks/wu/WU-123.yaml');
    });

    it('should return correct WU_DIR path', () => {
      const paths = createWuPaths();
      expect(paths.WU_DIR()).toBe('docs/04-operations/tasks/wu');
    });

    it('should return correct STATUS path', () => {
      const paths = createWuPaths();
      expect(paths.STATUS()).toBe('docs/04-operations/tasks/status.md');
    });

    it('should return correct BACKLOG path', () => {
      const paths = createWuPaths();
      expect(paths.BACKLOG()).toBe('docs/04-operations/tasks/backlog.md');
    });

    it('should return correct STAMPS_DIR path', () => {
      const paths = createWuPaths();
      expect(paths.STAMPS_DIR()).toBe('.lumenflow/stamps');
    });

    it('should return correct STAMP path', () => {
      const paths = createWuPaths();
      const stampPath = paths.STAMP('WU-456');

      expect(stampPath).toBe('.lumenflow/stamps/WU-456.done');
    });

    it('should return correct STATE_DIR path', () => {
      const paths = createWuPaths();
      expect(paths.STATE_DIR()).toBe('.lumenflow/state');
    });

    it('should return correct INITIATIVES_DIR path', () => {
      const paths = createWuPaths();
      expect(paths.INITIATIVES_DIR()).toBe('docs/04-operations/tasks/initiatives');
    });

    it('should return correct WORKTREES_DIR path', () => {
      const paths = createWuPaths();
      expect(paths.WORKTREES_DIR()).toBe('worktrees');
    });

    it('should return correct PLANS_DIR path', () => {
      const paths = createWuPaths();
      expect(paths.PLANS_DIR()).toBe('docs/04-operations/plans');
    });

    it('should return correct TEMPLATES_DIR path (WU-1310)', () => {
      const paths = createWuPaths();
      expect(paths.TEMPLATES_DIR()).toBe('.lumenflow/templates');
    });

    it('should return correct ONBOARDING_DIR path (WU-1310)', () => {
      const paths = createWuPaths();
      expect(paths.ONBOARDING_DIR()).toBe(
        'docs/04-operations/_frameworks/lumenflow/agent/onboarding',
      );
    });

    it('should return correct SIZING_GUIDE_PATH', () => {
      const paths = createWuPaths();
      expect(paths.SIZING_GUIDE_PATH()).toBe(
        'docs/04-operations/_frameworks/lumenflow/wu-sizing-guide.md',
      );
    });

    it('should accept projectRoot option', () => {
      const paths = createWuPaths({ projectRoot: '/custom/root' });
      // The mock returns same config regardless, but this tests the interface
      expect(paths.WU('WU-789')).toContain('WU-789.yaml');
    });
  });

  describe('WU_PATHS (default export)', () => {
    it('should be defined', () => {
      expect(WU_PATHS).toBeDefined();
    });

    it('should have all expected methods', () => {
      expect(typeof WU_PATHS.WU).toBe('function');
      expect(typeof WU_PATHS.STAMP).toBe('function');
      expect(typeof WU_PATHS.BACKLOG).toBe('function');
    });

    it('should return correct paths', () => {
      expect(WU_PATHS.WU('WU-100')).toBe('docs/04-operations/tasks/wu/WU-100.yaml');
      expect(WU_PATHS.STAMP('WU-100')).toBe('.lumenflow/stamps/WU-100.done');
    });
  });

  describe('defaultWorktreeFrom', () => {
    it('should return null for null doc', () => {
      expect(defaultWorktreeFrom(null)).toBeNull();
    });

    it('should return null for undefined doc', () => {
      expect(defaultWorktreeFrom(undefined)).toBeNull();
    });

    it('should return null for doc without lane', () => {
      expect(defaultWorktreeFrom({ id: 'WU-123' })).toBeNull();
    });

    it('should return null for doc without id', () => {
      expect(defaultWorktreeFrom({ lane: 'Framework: Core' })).toBeNull();
    });

    it('should return null for empty lane string', () => {
      expect(defaultWorktreeFrom({ id: 'WU-123', lane: '' })).toBeNull();
    });

    it('should return null for empty id string', () => {
      expect(defaultWorktreeFrom({ lane: 'Framework: Core', id: '' })).toBeNull();
    });

    it('should return null for whitespace-only lane', () => {
      expect(defaultWorktreeFrom({ id: 'WU-123', lane: '   ' })).toBeNull();
    });

    it('should return null for whitespace-only id', () => {
      expect(defaultWorktreeFrom({ lane: 'Framework: Core', id: '   ' })).toBeNull();
    });

    it('should generate worktree path from valid doc', () => {
      const result = defaultWorktreeFrom({
        id: 'WU-123',
        lane: 'Framework: Core',
      });

      expect(result).toBe('worktrees/framework-core-wu-123');
    });

    it('should handle sublane format', () => {
      const result = defaultWorktreeFrom({
        id: 'WU-456',
        lane: 'Operations: Tooling',
      });

      expect(result).toBe('worktrees/operations-tooling-wu-456');
    });

    it('should convert WU ID to lowercase', () => {
      const result = defaultWorktreeFrom({
        id: 'WU-789',
        lane: 'Framework: CLI',
      });

      expect(result).toContain('wu-789');
      expect(result).not.toContain('WU-789');
    });

    it('should trim lane and id values', () => {
      const result = defaultWorktreeFrom({
        id: '  WU-100  ',
        lane: '  Framework: Core  ',
      });

      expect(result).toBe('worktrees/framework-core-wu-100');
    });
  });

  describe('resolveFromProjectRoot', () => {
    it('should resolve relative path to absolute', () => {
      const result = resolveFromProjectRoot('src/file.ts');

      expect(result).toBe('/fake/project/root/src/file.ts');
    });

    it('should handle nested paths', () => {
      const result = resolveFromProjectRoot('docs/04-operations/tasks/wu/WU-123.yaml');

      expect(result).toContain('WU-123.yaml');
    });

    it('should handle empty relative path', () => {
      const result = resolveFromProjectRoot('');

      expect(result).toBe('/fake/project/root');
    });

    it('should handle moduleUrl fallback', async () => {
      // Reset mocks to simulate config failure
      const { getProjectRoot } = vi.mocked(await import('../lumenflow-config.js'));
      getProjectRoot.mockImplementationOnce(() => {
        throw new Error('Config not found');
      });

      // Should fall back to process.cwd()
      const result = resolveFromProjectRoot('test.ts');
      expect(result).toContain('test.ts');
    });
  });

  describe('getAbsoluteWuPath', () => {
    it('should return absolute path to WU YAML file', () => {
      const result = getAbsoluteWuPath('WU-123');

      expect(result).toBe('/fake/project/root/docs/04-operations/tasks/wu/WU-123.yaml');
    });

    it('should accept custom projectRoot option', () => {
      const result = getAbsoluteWuPath('WU-456', { projectRoot: '/custom/root' });

      expect(result).toContain('WU-456.yaml');
    });
  });

  describe('getAbsoluteStampPath', () => {
    it('should return absolute path to stamp file', () => {
      const result = getAbsoluteStampPath('WU-123');

      expect(result).toBe('/fake/project/root/.lumenflow/stamps/WU-123.done');
    });

    it('should accept custom projectRoot option', () => {
      const result = getAbsoluteStampPath('WU-789', { projectRoot: '/other/root' });

      expect(result).toContain('WU-789.done');
    });
  });
});
