import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSandboxAllowlist, isWritePathAllowed } from '../sandbox-allowlist.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('sandbox-allowlist', () => {
  it('resolves canonical writable roots for existing paths', () => {
    const repoRoot = makeTempDir('lumenflow-sandbox-canonical-');
    const worktree = path.join(repoRoot, 'worktrees/framework-core-validation-wu-1684');
    fs.mkdirSync(worktree, { recursive: true });

    const allowlist = buildSandboxAllowlist({
      projectRoot: repoRoot,
      writableRoots: [worktree],
    });

    expect(allowlist.writableRoots).toHaveLength(1);
    expect(allowlist.writableRoots[0].canonicalPath).toBe(worktree);
  });

  it('allows writes inside normalized writable roots', () => {
    const repoRoot = makeTempDir('lumenflow-sandbox-allowlist-');
    const worktree = path.join(repoRoot, 'worktrees/framework-core-validation-wu-1684');
    fs.mkdirSync(path.join(worktree, 'packages', '@lumenflow', 'core'), { recursive: true });

    const allowlist = buildSandboxAllowlist({
      projectRoot: repoRoot,
      writableRoots: [worktree],
    });

    const targetFile = path.join(worktree, 'packages', '@lumenflow', 'core', 'sandbox-profile.ts');
    expect(isWritePathAllowed(allowlist, targetFile)).toBe(true);
  });

  it('denies ../ traversal outside writable roots', () => {
    const repoRoot = makeTempDir('lumenflow-sandbox-traversal-');
    const worktree = path.join(repoRoot, 'worktrees/framework-core-validation-wu-1684');
    fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });

    const allowlist = buildSandboxAllowlist({
      projectRoot: repoRoot,
      writableRoots: [worktree],
    });

    const escapedPath = path.join(worktree, '..', '..', 'packages', 'evil.ts');
    expect(isWritePathAllowed(allowlist, escapedPath)).toBe(false);
  });

  it('denies symlink escape writes even when lexical path is in worktree', () => {
    const repoRoot = makeTempDir('lumenflow-sandbox-symlink-');
    const worktree = path.join(repoRoot, 'worktrees/framework-core-validation-wu-1684');
    const mainCheckout = path.join(repoRoot, 'packages');
    fs.mkdirSync(path.join(worktree, 'links'), { recursive: true });
    fs.mkdirSync(mainCheckout, { recursive: true });

    const linkPath = path.join(worktree, 'links', 'main-packages');
    fs.symlinkSync(mainCheckout, linkPath, 'dir');

    const allowlist = buildSandboxAllowlist({
      projectRoot: repoRoot,
      writableRoots: [worktree],
    });

    const escapeWriteTarget = path.join(linkPath, 'should-not-write.ts');
    expect(isWritePathAllowed(allowlist, escapeWriteTarget)).toBe(false);
  });
});
