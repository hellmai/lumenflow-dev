// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { execFileSync } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createWorktreeTool,
  listWorktreesTool,
  removeWorktreeTool,
} from '../tool-impl/worktree-tools.js';
import { GIT_BINARY } from '../tool-impl/git-runner.js';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const execFileSyncMock = vi.mocked(execFileSync);

function mockExecFileSyncResult(result: string | Buffer) {
  execFileSyncMock.mockReturnValue(result as ReturnType<typeof execFileSync>);
}

describe('software delivery worktree tools', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
  });

  it('creates worktree using git worktree add', async () => {
    mockExecFileSyncResult('added');

    const result = await createWorktreeTool({
      cwd: '/repo',
      path: '/repo/worktrees/wu-1',
      branch: 'lane/framework/wu-1',
    });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      GIT_BINARY,
      ['worktree', 'add', '/repo/worktrees/wu-1', 'lane/framework/wu-1'],
      { cwd: '/repo', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    expect(result).toEqual({
      success: true,
      stdout: 'added',
      stderr: '',
    });
  });

  it('removes worktree with optional --force flag', async () => {
    mockExecFileSyncResult('');
    await removeWorktreeTool({ cwd: '/repo', path: '/repo/worktrees/wu-1', force: true });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      GIT_BINARY,
      ['worktree', 'remove', '--force', '/repo/worktrees/wu-1'],
      { cwd: '/repo', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );

    execFileSyncMock.mockReset();
    mockExecFileSyncResult('');
    await removeWorktreeTool({ cwd: '/repo', path: '/repo/worktrees/wu-2' });

    expect(execFileSyncMock).toHaveBeenCalledWith(
      GIT_BINARY,
      ['worktree', 'remove', '/repo/worktrees/wu-2'],
      { cwd: '/repo', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  });

  it('returns failed command details when git exits non-zero', async () => {
    execFileSyncMock.mockImplementation(() => {
      throw {
        status: 128,
        stdout: undefined,
        stderr: Buffer.from('fatal: invalid worktree'),
      };
    });

    const result = await listWorktreesTool({ cwd: '/repo' });

    expect(result).toEqual({
      success: false,
      stdout: '',
      stderr: 'fatal: invalid worktree',
    });
  });
});
