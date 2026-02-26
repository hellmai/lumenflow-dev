// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
const mockGetCommitHash = vi.fn();
const mockRaw = vi.fn();

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: vi.fn(() => ({
    fetch: mockFetch,
    getCommitHash: mockGetCommitHash,
    raw: mockRaw,
  })),
}));

vi.mock('@lumenflow/core/commands-logger', () => ({
  scanLogForViolations: vi.fn().mockReturnValue([]),
  rotateLog: vi.fn(),
}));

vi.mock('@lumenflow/core/config', () => ({
  getConfig: vi.fn().mockReturnValue({
    directories: {
      wuDir: 'docs/04-operations/tasks/wu',
      statusPath: 'docs/04-operations/tasks/status.md',
      backlogPath: 'docs/04-operations/tasks/backlog.md',
    },
  }),
}));

vi.mock('@lumenflow/core/docs-path-validator', () => ({
  validateDocsOnly: vi.fn().mockReturnValue({ valid: true, violations: [] }),
  getAllowedPathsDescription: vi.fn().mockReturnValue(''),
}));

vi.mock('../state-path-resolvers.js', () => ({
  resolveWuEventsRelativePath: vi.fn().mockReturnValue('.lumenflow/state/wu-events.jsonl'),
}));

describe('wu-done git ops cleanup (WU-2207)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not export deprecated ensureMainUpToDate helper', async () => {
    const mod = await import('../wu-done-git-ops.js');
    expect(mod).not.toHaveProperty('ensureMainUpToDate');
  });

  it('uses injected adapter for detectParallelCompletions when provided', async () => {
    const { detectParallelCompletions } = await import('../wu-done-git-ops.js');
    const { getGitForCwd } = await import('@lumenflow/core/git-adapter');

    vi.mocked(getGitForCwd).mockImplementation(() => {
      throw new Error('getGitForCwd should not be called with injected adapter');
    });

    const injectedFetch = vi.fn().mockResolvedValue(undefined);
    const injectedGetCommitHash = vi.fn().mockResolvedValue('base1234');
    const injectedRaw = vi.fn().mockResolvedValue('');

    const result = await detectParallelCompletions('WU-2207', { baseline_main_sha: 'base1234' }, {
      fetch: injectedFetch,
      getCommitHash: injectedGetCommitHash,
      raw: injectedRaw,
    } as never);

    expect(result).toEqual({
      hasParallelCompletions: false,
      completedWUs: [],
      warning: null,
    });
    expect(injectedFetch).toHaveBeenCalledWith('origin', 'main');
    expect(injectedGetCommitHash).toHaveBeenCalledWith('origin/main');
  });
});
