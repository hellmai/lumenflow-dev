import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  resolveMainRepoFromWorktree,
  resolveCliDistEntry,
  selectCliEntryPath,
} from '../../../../tools/cli-entry.mjs';

describe('cli-entry worktree fallback (WU-1038)', () => {
  it('detects main repo path from worktree path', () => {
    const repoRoot = '/home/tom/source/hellmai/os';
    const worktreePath = `${repoRoot}/worktrees/framework-cli-wu-1038`;

    expect(resolveMainRepoFromWorktree(worktreePath)).toBe(repoRoot);
  });

  it('returns null when not inside a worktrees path', () => {
    const repoRoot = '/home/tom/source/hellmai/os';

    expect(resolveMainRepoFromWorktree(repoRoot)).toBeNull();
  });

  it('builds cli dist entry paths consistently', () => {
    const repoRoot = '/repo';
    const entry = 'gates';

    expect(resolveCliDistEntry(repoRoot, entry)).toBe(
      path.join('/repo', 'packages', '@lumenflow', 'cli', 'dist', 'gates.js'),
    );
  });

  it('prefers worktree dist when available', () => {
    const repoRoot = '/repo/worktrees/foo';
    const mainRepo = '/repo';
    const entry = 'gates';

    const entryPath = resolveCliDistEntry(repoRoot, entry);
    const fallbackPath = resolveCliDistEntry(mainRepo, entry);

    const selected = selectCliEntryPath({
      repoRoot,
      entry,
      mainRepoPath: mainRepo,
      exists: (candidate) => candidate === entryPath || candidate === fallbackPath,
    });

    expect(selected).toBe(entryPath);
  });

  it('falls back to main repo dist when worktree dist is missing', () => {
    const repoRoot = '/repo/worktrees/foo';
    const mainRepo = '/repo';
    const entry = 'gates';

    const fallbackPath = resolveCliDistEntry(mainRepo, entry);

    const selected = selectCliEntryPath({
      repoRoot,
      entry,
      mainRepoPath: mainRepo,
      exists: (candidate) => candidate === fallbackPath,
    });

    expect(selected).toBe(fallbackPath);
  });
});
