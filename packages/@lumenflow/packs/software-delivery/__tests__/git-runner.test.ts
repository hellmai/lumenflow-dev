// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileSyncMock = vi.fn();

vi.mock('node:child_process', () => ({
  execFileSync: (...args: unknown[]) => execFileSyncMock(...args),
}));

describe('software delivery git runner', () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    delete process.env.LUMENFLOW_GIT_BINARY;
    vi.resetModules();
  });

  it('uses explicit LUMENFLOW_GIT_BINARY override when provided', async () => {
    process.env.LUMENFLOW_GIT_BINARY = '/custom/git';

    const { GIT_BINARY } = await import('../tool-impl/git-runner.js');

    expect(GIT_BINARY).toBe('/custom/git');
    expect(execFileSyncMock).not.toHaveBeenCalled();
  });

  it('resolves git binary via PATH lookup when no override is configured', async () => {
    execFileSyncMock.mockReturnValue('/opt/homebrew/bin/git\n/usr/bin/git\n');

    const expectedLookupCommand = process.platform === 'win32' ? 'where' : 'which';
    const expectedLookupTarget = process.platform === 'win32' ? 'git.exe' : 'git';

    const { GIT_BINARY } = await import('../tool-impl/git-runner.js');

    expect(execFileSyncMock).toHaveBeenCalledWith(expectedLookupCommand, [expectedLookupTarget], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(GIT_BINARY).toBe('/opt/homebrew/bin/git');
  });

  it('runs git commands using resolved defaults and per-call overrides', async () => {
    execFileSyncMock.mockReturnValueOnce('/usr/bin/git\n').mockReturnValueOnce('on branch main\n');

    const gitRunner = await import('../tool-impl/git-runner.js');
    const result = gitRunner.runGit(['status', '--short'], {
      cwd: '/repo',
      gitBinary: 'git',
    });

    expect(execFileSyncMock).toHaveBeenLastCalledWith('git', ['status', '--short'], {
      cwd: '/repo',
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(result).toEqual({
      ok: true,
      stdout: 'on branch main\n',
      stderr: '',
      status: 0,
    });
  });
});
