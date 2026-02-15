import { lstatSync, mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { NESTED_PACKAGE_PATHS, symlinkNestedNodeModules } from '../worktree-symlink.js';

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
});
