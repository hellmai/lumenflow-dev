// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * WU-2198: Test that ensureMainUpToDate does NOT swallow ProcessExitError from die().
 *
 * The bug: the try/catch in ensureMainUpToDate catches ALL errors including
 * ProcessExitError thrown by die() when main is out of sync. This makes the
 * sync check a no-op — wu:done always proceeds regardless of sync state.
 *
 * Two scenarios:
 *   1. Sync mismatch (local != origin) -> die() -> ProcessExitError MUST propagate
 *   2. Fetch/network failure -> fail-open (warn + continue) -- existing policy preserved
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProcessExitError } from '@lumenflow/core/error-handler';

// Mock git adapter -- the only external dependency we need to control
const mockFetch = vi.fn();
const mockGetCommitHash = vi.fn();
const mockRevList = vi.fn();

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: vi.fn(() => ({
    fetch: mockFetch,
    getCommitHash: mockGetCommitHash,
    revList: mockRevList,
  })),
}));

// Mock the other imports that wu-done-git-ops.ts pulls in to avoid side effects
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

describe('ensureMainUpToDate sync bug (WU-2198)', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should throw ProcessExitError when main is out of sync with origin', async () => {
    // Arrange: fetch succeeds, but local and remote hashes differ
    mockFetch.mockResolvedValue(undefined);
    mockGetCommitHash
      .mockResolvedValueOnce('aaaa1111') // localMain
      .mockResolvedValueOnce('bbbb2222'); // remoteMain
    mockRevList
      .mockResolvedValueOnce('3') // behind count
      .mockResolvedValueOnce('0'); // ahead count

    const { ensureMainUpToDate } = await import('../wu-done-git-ops.js');

    // Act + Assert: ProcessExitError from die() must propagate, not be swallowed
    await expect(ensureMainUpToDate()).rejects.toThrow(ProcessExitError);
  });

  it('should fail open when fetch encounters a network error', async () => {
    // Arrange: fetch fails with a network error
    mockFetch.mockRejectedValue(new Error('Could not resolve host: github.com'));

    const { ensureMainUpToDate } = await import('../wu-done-git-ops.js');

    // Act: should NOT throw -- fail-open policy for network errors
    await expect(ensureMainUpToDate()).resolves.toBeUndefined();

    // Assert: warning was logged
    expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining('Proceeding anyway'));
  });

  it('should succeed silently when main is up-to-date', async () => {
    // Arrange: fetch succeeds, hashes match
    mockFetch.mockResolvedValue(undefined);
    const sameSha = 'cccc3333';
    mockGetCommitHash.mockResolvedValueOnce(sameSha).mockResolvedValueOnce(sameSha);

    const { ensureMainUpToDate } = await import('../wu-done-git-ops.js');

    // Act: should succeed without throwing
    await expect(ensureMainUpToDate()).resolves.toBeUndefined();

    // Assert: success message logged
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('up-to-date'));
  });

  it('should use injected adapter for ensureMainUpToDate when provided', async () => {
    const { ensureMainUpToDate } = await import('../wu-done-git-ops.js');
    const { getGitForCwd } = await import('@lumenflow/core/git-adapter');

    vi.mocked(getGitForCwd).mockImplementation(() => {
      throw new Error('getGitForCwd should not be called with injected adapter');
    });

    const injectedFetch = vi.fn().mockResolvedValue(undefined);
    const injectedGetCommitHash = vi.fn().mockResolvedValue('same-sha');
    const injectedRevList = vi.fn().mockResolvedValue('0');

    await expect(
      ensureMainUpToDate({
        fetch: injectedFetch,
        getCommitHash: injectedGetCommitHash,
        revList: injectedRevList,
      } as never),
    ).resolves.toBeUndefined();

    expect(injectedFetch).toHaveBeenCalledWith('origin', 'main');
    expect(injectedGetCommitHash).toHaveBeenCalledTimes(2);
  });

  it('should use injected adapter for detectParallelCompletions when provided', async () => {
    const { detectParallelCompletions } = await import('../wu-done-git-ops.js');
    const { getGitForCwd } = await import('@lumenflow/core/git-adapter');

    vi.mocked(getGitForCwd).mockImplementation(() => {
      throw new Error('getGitForCwd should not be called with injected adapter');
    });

    const injectedFetch = vi.fn().mockResolvedValue(undefined);
    const injectedGetCommitHash = vi.fn().mockResolvedValue('base1234');
    const injectedRaw = vi.fn().mockResolvedValue('');

    const result = await detectParallelCompletions(
      'WU-2204',
      { baseline_main_sha: 'base1234' },
      {
        fetch: injectedFetch,
        getCommitHash: injectedGetCommitHash,
        raw: injectedRaw,
      } as never,
    );

    expect(result).toEqual({
      hasParallelCompletions: false,
      completedWUs: [],
      warning: null,
    });
    expect(injectedFetch).toHaveBeenCalledWith('origin', 'main');
    expect(injectedGetCommitHash).toHaveBeenCalledWith('origin/main');
  });
});
