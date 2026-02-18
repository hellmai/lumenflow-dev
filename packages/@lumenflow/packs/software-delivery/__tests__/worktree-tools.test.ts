// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { spawnSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorktreeTool,
  listWorktreesTool,
  removeWorktreeTool,
} from '../tool-impl/worktree-tools.js';
import { GIT_BINARY } from '../tool-impl/git-runner.js';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}));

const spawnSyncMock = vi.mocked(spawnSync);

function mockSpawnSyncResult(result: Partial<ReturnType<typeof spawnSync>>) {
  spawnSyncMock.mockReturnValue(result as ReturnType<typeof spawnSync>);
}

describe('software delivery worktree tools', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
  });

  it('creates worktree using git worktree add', async () => {
    mockSpawnSyncResult({ status: 0, stdout: 'added', stderr: '' });

    const result = await createWorktreeTool({
      cwd: '/repo',
      path: '/repo/worktrees/wu-1',
      branch: 'lane/framework/wu-1',
    });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      GIT_BINARY,
      ['worktree', 'add', '/repo/worktrees/wu-1', 'lane/framework/wu-1'],
      { cwd: '/repo', encoding: 'utf8' },
    );
    expect(result).toEqual({
      success: true,
      stdout: 'added',
      stderr: '',
    });
  });

  it('removes worktree with optional --force flag', async () => {
    mockSpawnSyncResult({ status: 0, stdout: '', stderr: '' });
    await removeWorktreeTool({ cwd: '/repo', path: '/repo/worktrees/wu-1', force: true });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      GIT_BINARY,
      ['worktree', 'remove', '--force', '/repo/worktrees/wu-1'],
      { cwd: '/repo', encoding: 'utf8' },
    );

    spawnSyncMock.mockReset();
    mockSpawnSyncResult({ status: 0, stdout: '', stderr: '' });
    await removeWorktreeTool({ cwd: '/repo', path: '/repo/worktrees/wu-2' });

    expect(spawnSyncMock).toHaveBeenCalledWith(
      GIT_BINARY,
      ['worktree', 'remove', '/repo/worktrees/wu-2'],
      { cwd: '/repo', encoding: 'utf8' },
    );
  });

  it('returns failed command details when git exits non-zero', async () => {
    mockSpawnSyncResult({
      status: 128,
      stdout: undefined,
      stderr: Buffer.from('fatal: invalid worktree'),
    });

    const result = await listWorktreesTool({ cwd: '/repo' });

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'fatal: invalid worktree',
    });
  });
});
