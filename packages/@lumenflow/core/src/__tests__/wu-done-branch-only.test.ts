import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGit = {
  merge: vi.fn(),
  raw: vi.fn(),
};

vi.mock('../git-adapter.js', () => ({
  getGitForCwd: () => mockGit,
}));

import { mergeLaneBranch } from '../wu-done-branch-only.js';

describe('mergeLaneBranch retry behavior', () => {
  beforeEach(() => {
    mockGit.merge.mockReset();
    mockGit.raw.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retries ff-only merge after pull --rebase when first merge fails', async () => {
    mockGit.merge
      .mockRejectedValueOnce(new Error('not fast-forward'))
      .mockResolvedValueOnce(undefined);
    mockGit.raw.mockResolvedValue(undefined);

    await mergeLaneBranch('lane/framework-core/wu-1479');

    expect(mockGit.raw).toHaveBeenCalledWith(['pull', '--rebase', 'origin', 'main']);
    expect(mockGit.merge).toHaveBeenCalledTimes(2);
    expect(mockGit.merge).toHaveBeenLastCalledWith('lane/framework-core/wu-1479', {
      ffOnly: true,
    });
  });

  it('logs the first merge failure reason before retrying', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockGit.merge
      .mockRejectedValueOnce(new Error('simulated ff-only failure'))
      .mockResolvedValueOnce(undefined);
    mockGit.raw.mockResolvedValue(undefined);

    await mergeLaneBranch('lane/framework-core/wu-1479');

    const output = logSpy.mock.calls.map((call) => call.join(' ')).join('\n');
    expect(output).toContain('simulated ff-only failure');
    expect(output).toContain('pull --rebase');
  });
});
