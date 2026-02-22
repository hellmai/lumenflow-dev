// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NESTED_PACKAGE_PATHS,
  symlinkNestedNodeModules,
  symlinkWorkspaceBinArtifactRoots,
} from '../worktree-symlink.js';

describe('worktree-symlink', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('includes @lumenflow/mcp in nested package symlink targets', () => {
    expect(NESTED_PACKAGE_PATHS).toContain('packages/@lumenflow/mcp');
  });

  it('creates nested node_modules symlink for @lumenflow/mcp', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'worktree-symlink-'));
    tempDirs.push(root);

    const mainRepoPath = path.join(root, 'main');
    const worktreePath = path.join(root, 'worktree');
    const packagePath = 'packages/@lumenflow/mcp';
    const sourceNodeModules = path.join(mainRepoPath, packagePath, 'node_modules');
    const targetDir = path.join(worktreePath, packagePath);
    const targetNodeModules = path.join(targetDir, 'node_modules');

    mkdirSync(sourceNodeModules, { recursive: true });
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(path.join(sourceNodeModules, 'marker.txt'), 'ok');

    const result = symlinkNestedNodeModules(worktreePath, mainRepoPath);

    expect(result.errors).toHaveLength(0);
    expect(result.created).toBe(1);
    expect(lstatSync(targetNodeModules).isSymbolicLink()).toBe(true);
    expect(readlinkSync(targetNodeModules)).toBe(path.relative(targetDir, sourceNodeModules));
  });

  it('symlinks bin artifact roots from main repo into fresh worktree packages', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'worktree-bin-artifacts-'));
    tempDirs.push(root);

    const mainRepoPath = path.join(root, 'main');
    const worktreePath = path.join(root, 'worktree');
    const packagePath = 'packages/@lumenflow/core';
    const mainPackagePath = path.join(mainRepoPath, packagePath);
    const worktreePackagePath = path.join(worktreePath, packagePath);
    const mainDistPath = path.join(mainPackagePath, 'dist');
    const mainDistCliPath = path.join(mainDistPath, 'cli');
    const mainBinTargetPath = path.join(mainDistPath, 'cli', 'is-agent-branch.js');

    mkdirSync(mainDistCliPath, { recursive: true });
    mkdirSync(worktreePackagePath, { recursive: true });
    writeFileSync(
      path.join(mainPackagePath, 'package.json'),
      JSON.stringify({
        name: '@lumenflow/core',
        bin: {
          'is-agent-branch': './dist/cli/is-agent-branch.js',
        },
      }),
    );
    writeFileSync(mainBinTargetPath, 'console.log("ok");');
    writeFileSync(
      path.join(worktreePackagePath, 'package.json'),
      JSON.stringify({ name: '@lumenflow/core' }),
    );

    const result = symlinkWorkspaceBinArtifactRoots(worktreePath, mainRepoPath);
    const worktreeDistPath = path.join(worktreePackagePath, 'dist');

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
    expect(lstatSync(worktreeDistPath).isSymbolicLink()).toBe(true);
    expect(readlinkSync(worktreeDistPath)).toBe(path.relative(worktreePackagePath, mainDistPath));
  });

  it('skips node_modules-rooted bin targets while seeding workspace artifacts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'worktree-bin-artifacts-skip-'));
    tempDirs.push(root);

    const mainRepoPath = path.join(root, 'main');
    const worktreePath = path.join(root, 'worktree');
    const packagePath = 'packages/lumenflow';
    const mainPackagePath = path.join(mainRepoPath, packagePath);
    const worktreePackagePath = path.join(worktreePath, packagePath);

    mkdirSync(mainPackagePath, { recursive: true });
    mkdirSync(worktreePackagePath, { recursive: true });
    writeFileSync(
      path.join(mainPackagePath, 'package.json'),
      JSON.stringify({
        name: 'lumenflow',
        bin: {
          'wu-done': './node_modules/@lumenflow/cli/dist/wu-done.js',
        },
      }),
    );
    writeFileSync(
      path.join(worktreePackagePath, 'package.json'),
      JSON.stringify({ name: 'lumenflow' }),
    );

    const result = symlinkWorkspaceBinArtifactRoots(worktreePath, mainRepoPath);
    const worktreeNodeModulesPath = path.join(worktreePackagePath, 'node_modules');

    expect(result.created).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.skipped).toBeGreaterThan(0);
    expect(() => lstatSync(worktreeNodeModulesPath)).toThrow();
  });
});
