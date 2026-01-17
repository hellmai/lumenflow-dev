/**
 * @file worktree-symlink.test.mjs
 * @description Tests for worktree symlink utilities
 *
 * WU-1443: Root node_modules symlinking
 * WU-1579: Nested package node_modules symlinking
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  symlinkNodeModules,
  symlinkNestedNodeModules,
  NESTED_PACKAGE_PATHS,
  hasWorktreePathSymlinks,
} from '../worktree-symlink.js';

describe('worktree-symlink', () => {
  let tempDir;
  let mockMainRepoDir;

  beforeEach(() => {
    // Create temp directories for testing
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-symlink-test-'));
    mockMainRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'main-repo-test-'));

    // Create mock nested node_modules in "main repo"
    for (const pkgPath of NESTED_PACKAGE_PATHS) {
      const nodeModulesPath = path.join(mockMainRepoDir, pkgPath, 'node_modules');
      fs.mkdirSync(nodeModulesPath, { recursive: true });
      // Add a marker file to verify symlink works
      fs.writeFileSync(path.join(nodeModulesPath, '.test-marker'), 'test');
    }
  });

  afterEach(() => {
    // Cleanup temp directories
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (mockMainRepoDir && fs.existsSync(mockMainRepoDir)) {
      fs.rmSync(mockMainRepoDir, { recursive: true, force: true });
    }
  });

  describe('NESTED_PACKAGE_PATHS', () => {
    it('should export the list of nested package paths', () => {
      expect(Array.isArray(NESTED_PACKAGE_PATHS)).toBeTruthy();
      expect(NESTED_PACKAGE_PATHS.length > 0).toBeTruthy();
    });

    it('should contain all expected packages and apps', () => {
      // WU-2427: Expanded list to include all workspace packages
      expect(NESTED_PACKAGE_PATHS.length).toBe(15);
      // Packages - supabase
      expect(NESTED_PACKAGE_PATHS).toContain('packages/supabase');
      // Packages - @exampleapp/*
      expect(NESTED_PACKAGE_PATHS).toContain('packages/@exampleapp/prompts');
      expect(NESTED_PACKAGE_PATHS).toContain('packages/@exampleapp/shared');
      expect(NESTED_PACKAGE_PATHS).toContain('packages/@exampleapp/application');
      expect(NESTED_PACKAGE_PATHS).toContain('packages/@exampleapp/ports');
      expect(NESTED_PACKAGE_PATHS).toContain('packages/@exampleapp/infrastructure');
      // Packages - @lumenflow/*
      expect(NESTED_PACKAGE_PATHS).toContain('packages/@lumenflow/api');
      expect(NESTED_PACKAGE_PATHS).toContain('packages/@lumenflow/application');
      expect(NESTED_PACKAGE_PATHS).toContain('packages/@lumenflow/infrastructure');
      // Packages - lumenflow-*
      expect(NESTED_PACKAGE_PATHS).toContain('packages/lumenflow-cli');
      expect(NESTED_PACKAGE_PATHS).toContain('packages/lumenflow-tools');
      // Packages - beacon-explainer
      expect(NESTED_PACKAGE_PATHS).toContain('packages/beacon-explainer');
      // Apps
      expect(NESTED_PACKAGE_PATHS).toContain('apps/web');
      expect(NESTED_PACKAGE_PATHS).toContain('apps/mobile');
      expect(NESTED_PACKAGE_PATHS).toContain('apps/hellm-ai');
    });
  });

  describe('symlinkNodeModules (root)', () => {
    it('should create symlink to root node_modules', () => {
      const worktreePath = tempDir;
      const result = symlinkNodeModules(worktreePath);

      expect(result.created).toBe(true);
      expect(result.skipped).toBe(false);
      expect(!result.error).toBeTruthy();

      const symlinkPath = path.join(worktreePath, 'node_modules');
      // Use lstatSync to check symlink exists (existsSync follows symlinks and fails if target missing)
      let stat;
      try {
        stat = fs.lstatSync(symlinkPath);
      } catch {
        throw new Error(`Symlink should exist at ${symlinkPath}`);
      }
      assert.ok(stat.isSymbolicLink(), 'Should be a symbolic link');
    });

    it('should skip if node_modules already exists', () => {
      const worktreePath = tempDir;
      // Create existing node_modules
      fs.mkdirSync(path.join(worktreePath, 'node_modules'));

      const result = symlinkNodeModules(worktreePath);

      expect(result.created).toBe(false);
      expect(result.skipped).toBe(true);
    });

    it('should be idempotent', () => {
      const worktreePath = tempDir;

      // First call creates
      const result1 = symlinkNodeModules(worktreePath);
      expect(result1.created).toBe(true);

      // Second call skips (symlink exists even if target doesn't)
      const result2 = symlinkNodeModules(worktreePath);
      expect(result2.skipped).toBe(true);
    });
  });

  describe('symlinkNestedNodeModules (WU-1579)', () => {
    it('should create symlinks for all nested package node_modules', () => {
      const worktreePath = tempDir;
      const mainRepoPath = mockMainRepoDir;

      // Create parent directories in worktree for nested packages
      for (const pkgPath of NESTED_PACKAGE_PATHS) {
        fs.mkdirSync(path.join(worktreePath, pkgPath), { recursive: true });
      }

      const result = symlinkNestedNodeModules(worktreePath, mainRepoPath);

      expect(result.created).toBe(NESTED_PACKAGE_PATHS.length);
      expect(result.skipped).toBe(0);
      expect(!result.errors || result.errors.length === 0).toBeTruthy();

      // Verify each symlink was created and points to correct location
      for (const pkgPath of NESTED_PACKAGE_PATHS) {
        const symlinkPath = path.join(worktreePath, pkgPath, 'node_modules');
        assert.ok(fs.existsSync(symlinkPath), `Symlink should exist at ${symlinkPath}`);
        assert.ok(fs.lstatSync(symlinkPath).isSymbolicLink(), `${symlinkPath} should be a symlink`);

        // Verify symlink target is accessible
        const markerPath = path.join(symlinkPath, '.test-marker');
        assert.ok(fs.existsSync(markerPath), `Symlink should resolve correctly for ${pkgPath}`);
      }
    });

    it('should skip packages where node_modules has real content', () => {
      const worktreePath = tempDir;
      const mainRepoPath = mockMainRepoDir;

      // Create parent directories and pre-create some node_modules
      for (const pkgPath of NESTED_PACKAGE_PATHS) {
        fs.mkdirSync(path.join(worktreePath, pkgPath), { recursive: true });
      }

      // Pre-create node_modules for first 2 packages WITH real content
      // Empty directories or those with only cache (.vite, .turbo) are replaced
      const preExisting = NESTED_PACKAGE_PATHS.slice(0, 2);
      for (const pkgPath of preExisting) {
        const nodeModulesPath = path.join(worktreePath, pkgPath, 'node_modules');
        fs.mkdirSync(nodeModulesPath);
        // Add real content (non-cache file) so it gets skipped
        fs.writeFileSync(path.join(nodeModulesPath, 'some-package'), 'content');
      }

      const result = symlinkNestedNodeModules(worktreePath, mainRepoPath);

      expect(result.created).toBe(NESTED_PACKAGE_PATHS.length - 2);
      expect(result.skipped).toBe(2);
    });

    it('should replace empty or cache-only node_modules with symlink', () => {
      const worktreePath = tempDir;
      const mainRepoPath = mockMainRepoDir;

      // Create parent directories
      for (const pkgPath of NESTED_PACKAGE_PATHS) {
        fs.mkdirSync(path.join(worktreePath, pkgPath), { recursive: true });
      }

      // Pre-create node_modules for first 2 packages with only cache files
      const cacheOnly = NESTED_PACKAGE_PATHS.slice(0, 2);
      for (const pkgPath of cacheOnly) {
        const nodeModulesPath = path.join(worktreePath, pkgPath, 'node_modules');
        fs.mkdirSync(nodeModulesPath);
        fs.mkdirSync(path.join(nodeModulesPath, '.vite')); // Cache directory
      }

      const result = symlinkNestedNodeModules(worktreePath, mainRepoPath);

      // All should be created (cache-only directories are replaced)
      expect(result.created).toBe(NESTED_PACKAGE_PATHS.length);
      expect(result.skipped).toBe(0);

      // Verify the first one is now a symlink
      const firstSymlink = path.join(worktreePath, cacheOnly[0], 'node_modules');
      expect(fs.lstatSync(firstSymlink).isSymbolicLink()).toBeTruthy();
    });

    it('should skip packages where source node_modules does not exist', () => {
      const worktreePath = tempDir;
      // Create a new main repo without any node_modules
      const emptyMainRepo = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-main-'));

      for (const pkgPath of NESTED_PACKAGE_PATHS) {
        fs.mkdirSync(path.join(worktreePath, pkgPath), { recursive: true });
      }

      const result = symlinkNestedNodeModules(worktreePath, emptyMainRepo);

      expect(result.created).toBe(0);
      expect(result.skipped).toBe(NESTED_PACKAGE_PATHS.length);

      // Cleanup
      fs.rmSync(emptyMainRepo, { recursive: true, force: true });
    });

    it('should handle missing parent directories gracefully', () => {
      const worktreePath = tempDir;
      const mainRepoPath = mockMainRepoDir;

      // Don't create any parent directories in worktree
      // The function should handle this gracefully

      const result = symlinkNestedNodeModules(worktreePath, mainRepoPath);

      // Should skip all because parent directories don't exist
      expect(result.created).toBe(0);
      expect(result.skipped).toBe(NESTED_PACKAGE_PATHS.length);
    });

    it('should use correct relative path from worktree to main repo', () => {
      // Simulate real worktree structure: worktrees/<lane>-wu-<id>
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-'));
      const worktreesDir = path.join(projectRoot, 'worktrees');
      const worktreePath = path.join(worktreesDir, 'operations-tooling-wu-1579');
      fs.mkdirSync(worktreePath, { recursive: true });

      // Create nested package directory structure in worktree
      const testPkgPath = 'packages/@exampleapp/prompts';
      fs.mkdirSync(path.join(worktreePath, testPkgPath), { recursive: true });

      // Create source node_modules in project root
      const sourceNodeModules = path.join(projectRoot, testPkgPath, 'node_modules');
      fs.mkdirSync(sourceNodeModules, { recursive: true });
      fs.writeFileSync(path.join(sourceNodeModules, '.marker'), 'test');

      const result = symlinkNestedNodeModules(worktreePath, projectRoot);

      // Verify symlink resolves correctly
      const symlinkPath = path.join(worktreePath, testPkgPath, 'node_modules');
      expect(fs.existsSync(symlinkPath)).toBeTruthy();
      assert.ok(fs.existsSync(path.join(symlinkPath, '.marker')));

      // Cleanup
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('should use silent logger to avoid noisy output', () => {
      const worktreePath = tempDir;
      const mainRepoPath = mockMainRepoDir;

      for (const pkgPath of NESTED_PACKAGE_PATHS) {
        fs.mkdirSync(path.join(worktreePath, pkgPath), { recursive: true });
      }

      // Should not throw and should work with default silent logging
      const result = symlinkNestedNodeModules(worktreePath, mainRepoPath);

      expect(result.created >= 0).toBeTruthy();
    });

    it('should be idempotent', () => {
      const worktreePath = tempDir;
      const mainRepoPath = mockMainRepoDir;

      for (const pkgPath of NESTED_PACKAGE_PATHS) {
        fs.mkdirSync(path.join(worktreePath, pkgPath), { recursive: true });
      }

      // First call creates all
      const result1 = symlinkNestedNodeModules(worktreePath, mainRepoPath);
      expect(result1.created).toBe(NESTED_PACKAGE_PATHS.length);

      // Second call skips all
      const result2 = symlinkNestedNodeModules(worktreePath, mainRepoPath);
      expect(result2.created).toBe(0);
      expect(result2.skipped).toBe(NESTED_PACKAGE_PATHS.length);
    });
  });

  describe('hasWorktreePathSymlinks (WU-2238)', () => {
    it('should return false for node_modules with no symlinks', () => {
      // Create a node_modules with regular files only
      const nodeModulesPath = path.join(mockMainRepoDir, 'node_modules');
      fs.mkdirSync(nodeModulesPath, { recursive: true });
      fs.writeFileSync(path.join(nodeModulesPath, 'some-package'), 'content');

      const result = hasWorktreePathSymlinks(nodeModulesPath);

      expect(result.hasWorktreeSymlinks).toBe(false);
      expect(result.brokenSymlinks).toEqual([]);
    });

    it('should return false for node_modules with valid symlinks not in worktrees/', () => {
      // Create a node_modules with symlink to a valid path outside worktrees/
      const nodeModulesPath = path.join(mockMainRepoDir, 'node_modules');
      fs.mkdirSync(nodeModulesPath, { recursive: true });

      // Create a target directory and symlink to it
      const targetDir = path.join(mockMainRepoDir, 'packages', 'some-package');
      fs.mkdirSync(targetDir, { recursive: true });
      fs.symlinkSync(targetDir, path.join(nodeModulesPath, 'some-package'));

      const result = hasWorktreePathSymlinks(nodeModulesPath);

      expect(result.hasWorktreeSymlinks).toBe(false);
      expect(result.brokenSymlinks).toEqual([]);
    });

    it('should return true for node_modules with symlinks pointing into worktrees/', () => {
      // Create a project structure that simulates the bug scenario
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-root-'));
      const nodeModulesPath = path.join(projectRoot, 'node_modules');
      const worktreesDir = path.join(projectRoot, 'worktrees');
      const worktreePath = path.join(worktreesDir, 'some-lane-wu-123');

      fs.mkdirSync(nodeModulesPath, { recursive: true });
      fs.mkdirSync(worktreePath, { recursive: true });

      // Create a symlink that points into the worktrees directory (the bug scenario)
      // This happens when pnpm install runs inside a worktree
      const worktreeTarget = path.join(worktreePath, '.pnpm', 'some-package');
      fs.mkdirSync(worktreeTarget, { recursive: true });
      fs.symlinkSync(worktreeTarget, path.join(nodeModulesPath, 'bad-package'));

      const result = hasWorktreePathSymlinks(nodeModulesPath);

      expect(result.hasWorktreeSymlinks).toBe(true);
      expect(result.brokenSymlinks.length).toBe(0); // Symlink is valid, just points to worktree

      // Cleanup
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('should detect broken symlinks (pointing to removed worktree)', () => {
      // Create a project structure where the worktree has been removed
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-root-'));
      const nodeModulesPath = path.join(projectRoot, 'node_modules');

      fs.mkdirSync(nodeModulesPath, { recursive: true });

      // Create a symlink that points to a non-existent worktree path
      // This is what happens after a worktree is removed
      const brokenTarget = path.join(projectRoot, 'worktrees', 'deleted-wu-456', '.pnpm', 'pkg');
      fs.symlinkSync(brokenTarget, path.join(nodeModulesPath, 'broken-package'));

      const result = hasWorktreePathSymlinks(nodeModulesPath);

      expect(result.hasWorktreeSymlinks).toBe(true);
      expect(result.brokenSymlinks.length).toBe(1);
      expect(result.brokenSymlinks[0].includes('broken-package')).toBe(true);

      // Cleanup
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('should scan .pnpm directory for worktree-path symlinks', () => {
      // pnpm stores packages in node_modules/.pnpm with symlinks
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-root-'));
      const nodeModulesPath = path.join(projectRoot, 'node_modules');
      const pnpmDir = path.join(nodeModulesPath, '.pnpm');
      const worktreeTarget = path.join(projectRoot, 'worktrees', 'lane-wu-789', 'some-path');

      fs.mkdirSync(pnpmDir, { recursive: true });

      // Create a symlink inside .pnpm pointing to a worktree (valid path for test)
      fs.mkdirSync(worktreeTarget, { recursive: true });
      fs.symlinkSync(worktreeTarget, path.join(pnpmDir, 'bad-link'));

      const result = hasWorktreePathSymlinks(nodeModulesPath);

      expect(result.hasWorktreeSymlinks).toBe(true);

      // Cleanup
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('should handle non-existent node_modules gracefully', () => {
      const nonExistentPath = path.join(tempDir, 'non-existent-node_modules');

      const result = hasWorktreePathSymlinks(nonExistentPath);

      expect(result.hasWorktreeSymlinks).toBe(false);
      expect(result.brokenSymlinks).toEqual([]);
    });

    it('should return false for empty node_modules', () => {
      const nodeModulesPath = path.join(mockMainRepoDir, 'node_modules');
      fs.mkdirSync(nodeModulesPath, { recursive: true });

      const result = hasWorktreePathSymlinks(nodeModulesPath);

      expect(result.hasWorktreeSymlinks).toBe(false);
      expect(result.brokenSymlinks).toEqual([]);
    });
  });

  describe('symlinkNodeModules with worktree-path detection (WU-2238)', () => {
    it('should refuse to create symlink when target has worktree-path symlinks', () => {
      // Create a main repo with node_modules containing worktree-path symlinks
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-'));
      const mainNodeModules = path.join(projectRoot, 'node_modules');
      const worktreePath = path.join(projectRoot, 'worktrees', 'new-worktree');

      fs.mkdirSync(mainNodeModules, { recursive: true });
      fs.mkdirSync(worktreePath, { recursive: true });

      // Create a symlink pointing into a (now deleted) worktree path
      const brokenTarget = path.join(projectRoot, 'worktrees', 'old-wu-999', '.pnpm', 'pkg');
      fs.symlinkSync(brokenTarget, path.join(mainNodeModules, 'broken-pkg'));

      // Try to create symlink in new worktree - should be refused
      const result = symlinkNodeModules(worktreePath, console, projectRoot);

      expect(result.created).toBe(false);
      expect(result.skipped).toBe(false);
      expect(result.refused).toBe(true);
      expect(result.reason.includes('worktree')).toBe(true);

      // Cleanup
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('should create symlink when target has no worktree-path symlinks', () => {
      // Create a clean main repo with no worktree-path symlinks
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'project-'));
      const mainNodeModules = path.join(projectRoot, 'node_modules');
      const worktreePath = path.join(projectRoot, 'worktrees', 'new-worktree');

      fs.mkdirSync(mainNodeModules, { recursive: true });
      fs.mkdirSync(worktreePath, { recursive: true });

      // Add some normal content (not worktree symlinks)
      fs.writeFileSync(path.join(mainNodeModules, 'some-pkg'), 'content');

      // Try to create symlink - should succeed
      const result = symlinkNodeModules(worktreePath, console, projectRoot);

      expect(result.created).toBe(true);
      expect(result.skipped).toBe(false);
      expect(!result.refused).toBeTruthy();

      // Cleanup
      fs.rmSync(projectRoot, { recursive: true, force: true });
    });

    it('should skip worktree-path check when mainRepoPath is not provided (backward compat)', () => {
      const worktreePath = tempDir;

      // Without mainRepoPath, should still work as before (creates symlink)
      const result = symlinkNodeModules(worktreePath);

      expect(result.created).toBe(true);
      expect(result.skipped).toBe(false);
      expect(!result.refused).toBeTruthy();
    });
  });
});
