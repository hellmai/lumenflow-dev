// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';

const spawnSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  spawnSync: (...args: unknown[]) => spawnSyncMock(...args),
}));

describe('software delivery git runner', () => {
  beforeEach(() => {
    spawnSyncMock.mockReset();
    delete process.env.LUMENFLOW_GIT_BINARY;
    vi.resetModules();
  });

  it('uses explicit LUMENFLOW_GIT_BINARY override when provided', async () => {
    process.env.LUMENFLOW_GIT_BINARY = '/custom/git';

    const { GIT_BINARY } = await import('../tool-impl/git-runner.js');

    expect(GIT_BINARY).toBe('/custom/git');
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('resolves git binary via PATH lookup when no override is configured', async () => {
    spawnSyncMock.mockReturnValue({
      status: 0,
      stdout: '/opt/homebrew/bin/git\n/usr/bin/git\n',
      stderr: '',
    });

    const expectedLookupCommand = process.platform === 'win32' ? 'where' : 'which';
    const expectedLookupTarget = process.platform === 'win32' ? 'git.exe' : 'git';

    const { GIT_BINARY } = await import('../tool-impl/git-runner.js');

    expect(spawnSyncMock).toHaveBeenCalledWith(expectedLookupCommand, [expectedLookupTarget], {
      encoding: 'utf8',
    });
    expect(GIT_BINARY).toBe('/opt/homebrew/bin/git');
  });

  it('runs git commands using resolved defaults and per-call overrides', async () => {
    spawnSyncMock
      .mockReturnValueOnce({
        status: 0,
        stdout: '/usr/bin/git\n',
        stderr: '',
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: 'on branch main\n',
        stderr: '',
      });

    const gitRunner = await import('../tool-impl/git-runner.js');
    const result = gitRunner.runGit(['status', '--short'], {
      cwd: '/repo',
      gitBinary: 'git',
    });

    expect(spawnSyncMock).toHaveBeenLastCalledWith('git', ['status', '--short'], {
      cwd: '/repo',
      encoding: 'utf8',
    });
    expect(result).toEqual({
      ok: true,
      stdout: 'on branch main\n',
      stderr: '',
      status: 0,
    });
  });
});
