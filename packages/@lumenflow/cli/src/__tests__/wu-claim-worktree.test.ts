// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, describe, expect, it, vi } from 'vitest';

const TEST_WORKTREE_PATH = '/tmp/worktree-wu-1996';
const TEST_MAIN_REPO_PATH = '/tmp/main-wu-1996';

describe('wu-claim worktree dependency setup (WU-1996)', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('seeds workspace bin artifacts before running pnpm install in default setup mode', async () => {
    const execFileSync = vi.fn();
    const symlinkWorkspaceBinArtifactRoots = vi.fn().mockReturnValue({
      created: 2,
      skipped: 0,
      errors: [],
    });
    const symlinkNodeModules = vi.fn().mockReturnValue({ created: false, skipped: true });
    const symlinkNestedNodeModules = vi
      .fn()
      .mockReturnValue({ created: 0, skipped: 0, errors: [] });

    vi.doMock('node:child_process', async () => {
      const actual =
        await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync,
      };
    });

    vi.doMock('@lumenflow/core/worktree-symlink', async () => {
      const actual = await vi.importActual<typeof import('@lumenflow/core/worktree-symlink')>(
        '@lumenflow/core/worktree-symlink',
      );
      return {
        ...actual,
        symlinkNodeModules,
        symlinkNestedNodeModules,
        symlinkWorkspaceBinArtifactRoots,
      };
    });

    const moduleUnderTest = await import('../wu-claim-worktree.js');
    await moduleUnderTest.setupWorktreeDependencies(TEST_WORKTREE_PATH, TEST_MAIN_REPO_PATH, false);

    expect(symlinkWorkspaceBinArtifactRoots).toHaveBeenCalledWith(
      TEST_WORKTREE_PATH,
      TEST_MAIN_REPO_PATH,
      console,
    );
    expect(execFileSync).toHaveBeenCalledWith(
      'pnpm',
      ['install', '--frozen-lockfile'],
      expect.objectContaining({
        cwd: TEST_WORKTREE_PATH,
        stdio: 'inherit',
      }),
    );
  });

  it('preserves fallback symlink behavior when install fails after seeding', async () => {
    const installError = new Error('install failed');
    const execFileSync = vi.fn().mockImplementation(() => {
      throw installError;
    });
    const symlinkWorkspaceBinArtifactRoots = vi.fn().mockReturnValue({
      created: 1,
      skipped: 0,
      errors: [],
    });
    const symlinkNodeModules = vi.fn().mockReturnValue({ created: true, skipped: false });
    const symlinkNestedNodeModules = vi
      .fn()
      .mockReturnValue({ created: 2, skipped: 0, errors: [] });

    vi.doMock('node:child_process', async () => {
      const actual =
        await vi.importActual<typeof import('node:child_process')>('node:child_process');
      return {
        ...actual,
        execFileSync,
      };
    });

    vi.doMock('@lumenflow/core/worktree-symlink', async () => {
      const actual = await vi.importActual<typeof import('@lumenflow/core/worktree-symlink')>(
        '@lumenflow/core/worktree-symlink',
      );
      return {
        ...actual,
        symlinkNodeModules,
        symlinkNestedNodeModules,
        symlinkWorkspaceBinArtifactRoots,
      };
    });

    const moduleUnderTest = await import('../wu-claim-worktree.js');

    await moduleUnderTest.setupWorktreeDependencies(TEST_WORKTREE_PATH, TEST_MAIN_REPO_PATH, false);

    expect(symlinkWorkspaceBinArtifactRoots).toHaveBeenCalledTimes(1);
    expect(symlinkNodeModules).toHaveBeenCalledWith(
      TEST_WORKTREE_PATH,
      console,
      TEST_MAIN_REPO_PATH,
    );
    expect(symlinkNestedNodeModules).toHaveBeenCalledWith(TEST_WORKTREE_PATH, TEST_MAIN_REPO_PATH);
  });
});
