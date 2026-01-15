import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('../git-adapter.mjs', () => ({
  getGitForCwd: vi.fn(),
}));

import { exec } from 'node:child_process';
import { getGitForCwd } from '../git-adapter.mjs';
import { CLAIMED_MODES, PKG_COMMANDS, PKG_FLAGS, PKG_MANAGER } from '../wu-constants.mjs';

describe('WU-1760: runCleanup symlink repair is non-mutating', () => {
  const originalCwd = process.cwd();
  let tempWorktreeDir;

  beforeEach(async () => {
    tempWorktreeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'wu-1760-worktree-'));

    exec.mockImplementation((command, optionsOrCallback, callback) => {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      cb?.(null, '', '');
    });

    getGitForCwd.mockReturnValue({
      worktreeRemove: vi.fn().mockResolvedValue(undefined),
      branchExists: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
      raw: vi.fn().mockResolvedValue(''),
      add: vi.fn().mockResolvedValue(undefined),
      fetch: vi.fn().mockResolvedValue(undefined),
    });

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tempWorktreeDir) {
      await fs.rm(tempWorktreeDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it('runs pnpm install with --frozen-lockfile', async () => {
    const { runCleanup } = await import('../wu-done-validators.mjs');

    await runCleanup(
      { claimed_mode: CLAIMED_MODES.WORKTREE },
      {
        noRemove: false,
        createPR: false,
        worktree: tempWorktreeDir,
      }
    );

    const commands = exec.mock.calls.map(([cmd]) => cmd);
    expect(
      commands.some(
        (cmd) =>
          cmd.includes(`${PKG_MANAGER} ${PKG_COMMANDS.INSTALL}`) &&
          cmd.includes(PKG_FLAGS.FROZEN_LOCKFILE)
      )
    ).toBe(true);
  });
});
