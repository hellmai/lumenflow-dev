import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ATOMIC_MERGE_MODULE = '../atomic-merge.js';
const GIT_ADAPTER_MODULE = '../git-adapter.js';
const SHARED_MODULE = '../micro-worktree-shared.js';

interface AtomicMergeTestHarness {
  mainGit: {
    fetch: ReturnType<typeof vi.fn>;
    createBranchNoCheckout: ReturnType<typeof vi.fn>;
    worktreeAddExisting: ReturnType<typeof vi.fn>;
    merge: ReturnType<typeof vi.fn>;
  };
  gitWorktree: {
    merge: ReturnType<typeof vi.fn>;
    rebase: ReturnType<typeof vi.fn>;
  };
  shared: {
    getTempBranchName: ReturnType<typeof vi.fn>;
    createMicroWorktreeDir: ReturnType<typeof vi.fn>;
    cleanupOrphanedMicroWorktree: ReturnType<typeof vi.fn>;
    cleanupMicroWorktree: ReturnType<typeof vi.fn>;
    pushRefspecWithRetry: ReturnType<typeof vi.fn>;
    isRetryExhaustionError: ReturnType<typeof vi.fn>;
    formatRetryExhaustionError: ReturnType<typeof vi.fn>;
  };
}

function setupHarness(): AtomicMergeTestHarness {
  const mainGit = {
    fetch: vi.fn().mockResolvedValue(undefined),
    createBranchNoCheckout: vi.fn().mockResolvedValue(undefined),
    worktreeAddExisting: vi.fn().mockResolvedValue(undefined),
    merge: vi.fn().mockResolvedValue({ success: true }),
  };

  const gitWorktree = {
    merge: vi.fn().mockResolvedValue({ success: true }),
    rebase: vi.fn().mockResolvedValue(undefined),
  };

  const shared = {
    getTempBranchName: vi.fn().mockReturnValue('tmp/wu-done/wu-1627'),
    createMicroWorktreeDir: vi.fn().mockReturnValue('/tmp/wu-done-abc123'),
    cleanupOrphanedMicroWorktree: vi
      .fn()
      .mockResolvedValue({ cleanedWorktree: false, cleanedBranch: false }),
    cleanupMicroWorktree: vi.fn().mockResolvedValue(undefined),
    pushRefspecWithRetry: vi.fn().mockResolvedValue(undefined),
    isRetryExhaustionError: vi.fn((error: unknown) => {
      return error instanceof Error && /Push failed after \d+ attempts/.test(error.message);
    }),
    formatRetryExhaustionError: vi.fn((error: Error, options: { command: string }) => {
      return `${error.message}\n\nNext steps:\n  ${options.command}`;
    }),
  };

  vi.doMock(GIT_ADAPTER_MODULE, () => ({
    getGitForCwd: vi.fn().mockReturnValue(mainGit),
    createGitForPath: vi.fn().mockReturnValue(gitWorktree),
  }));

  vi.doMock(SHARED_MODULE, () => ({
    MAX_MERGE_RETRIES: 3,
    getTempBranchName: shared.getTempBranchName,
    createMicroWorktreeDir: shared.createMicroWorktreeDir,
    cleanupOrphanedMicroWorktree: shared.cleanupOrphanedMicroWorktree,
    cleanupMicroWorktree: shared.cleanupMicroWorktree,
    pushRefspecWithRetry: shared.pushRefspecWithRetry,
    isRetryExhaustionError: shared.isRetryExhaustionError,
    formatRetryExhaustionError: shared.formatRetryExhaustionError,
  }));

  return { mainGit, gitWorktree, shared };
}

describe('withAtomicMerge', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('merges lane branch in temp worktree, pushes to origin/main, and catches up local main', async () => {
    const h = setupHarness();
    const mod = await import(ATOMIC_MERGE_MODULE);

    const result = await mod.withAtomicMerge({
      id: 'WU-1627',
      laneBranch: 'lane/framework-core-lifecycle/wu-1627',
    });

    expect(result).toEqual({
      tempBranchName: 'tmp/wu-done/wu-1627',
      worktreePath: '/tmp/wu-done-abc123',
    });
    expect(h.shared.cleanupOrphanedMicroWorktree).toHaveBeenCalledWith(
      'wu-done',
      'WU-1627',
      h.mainGit,
      '[wu-done]',
    );
    expect(h.mainGit.fetch).toHaveBeenNthCalledWith(1, 'origin', 'main');
    expect(h.mainGit.createBranchNoCheckout).toHaveBeenCalledWith(
      'tmp/wu-done/wu-1627',
      'origin/main',
    );
    expect(h.mainGit.worktreeAddExisting).toHaveBeenCalledWith(
      '/tmp/wu-done-abc123',
      'tmp/wu-done/wu-1627',
    );
    expect(h.gitWorktree.merge).toHaveBeenCalledWith('lane/framework-core-lifecycle/wu-1627', {
      ffOnly: true,
    });
    expect(h.shared.pushRefspecWithRetry).toHaveBeenCalledWith(
      h.gitWorktree,
      h.mainGit,
      'origin',
      'tmp/wu-done/wu-1627',
      'main',
      'wu-done atomic merge push for WU-1627 (automated)',
      '[wu-done]',
    );
    expect(h.mainGit.merge).toHaveBeenCalledWith('origin/main', { ffOnly: true });
    expect(h.shared.cleanupMicroWorktree).toHaveBeenCalledWith(
      '/tmp/wu-done-abc123',
      'tmp/wu-done/wu-1627',
      '[wu-done]',
    );
  });

  it('treats local catch-up fetch failure as non-blocking after successful remote push', async () => {
    const h = setupHarness();
    h.mainGit.fetch
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('dirty metadata'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import(ATOMIC_MERGE_MODULE);
    const result = await mod.withAtomicMerge({
      id: 'WU-1627',
      laneBranch: 'lane/framework-core-lifecycle/wu-1627',
    });

    expect(result).toEqual({
      tempBranchName: 'tmp/wu-done/wu-1627',
      worktreePath: '/tmp/wu-done-abc123',
    });
    expect(h.shared.pushRefspecWithRetry).toHaveBeenCalledTimes(1);
    expect(h.mainGit.merge).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not fast-forward local main'),
    );
    warnSpy.mockRestore();
  });

  it('supports idempotent rerun when first completion had local catch-up friction', async () => {
    const h = setupHarness();
    h.mainGit.merge
      .mockRejectedValueOnce(new Error('not possible to fast-forward'))
      .mockResolvedValue({
        success: true,
      });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const mod = await import(ATOMIC_MERGE_MODULE);

    await expect(
      mod.withAtomicMerge({
        id: 'WU-1627',
        laneBranch: 'lane/framework-core-lifecycle/wu-1627',
      }),
    ).resolves.toEqual({
      tempBranchName: 'tmp/wu-done/wu-1627',
      worktreePath: '/tmp/wu-done-abc123',
    });

    await expect(
      mod.withAtomicMerge({
        id: 'WU-1627',
        laneBranch: 'lane/framework-core-lifecycle/wu-1627',
      }),
    ).resolves.toEqual({
      tempBranchName: 'tmp/wu-done/wu-1627',
      worktreePath: '/tmp/wu-done-abc123',
    });

    expect(h.shared.cleanupOrphanedMicroWorktree).toHaveBeenCalledTimes(2);
    expect(h.shared.pushRefspecWithRetry).toHaveBeenCalledTimes(2);
    expect(h.shared.cleanupMicroWorktree).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Could not fast-forward local main'),
    );
    warnSpy.mockRestore();
  });

  it('retries merge after origin movement and succeeds on later attempt', async () => {
    const h = setupHarness();
    h.gitWorktree.merge.mockRejectedValueOnce(new Error('not fast-forward'));
    h.gitWorktree.merge.mockResolvedValueOnce({ success: true });

    const mod = await import(ATOMIC_MERGE_MODULE);
    await mod.withAtomicMerge({
      id: 'WU-1627',
      laneBranch: 'lane/framework-core-lifecycle/wu-1627',
      mergeRetries: 2,
    });

    expect(h.gitWorktree.rebase).toHaveBeenCalledWith('origin/main');
    expect(h.shared.pushRefspecWithRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps live main untouched and returns terminal guidance when merge retries are exhausted', async () => {
    const h = setupHarness();
    h.gitWorktree.merge.mockRejectedValue(new Error('not fast-forward'));

    const mod = await import(ATOMIC_MERGE_MODULE);
    await expect(
      mod.withAtomicMerge({
        id: 'WU-1627',
        laneBranch: 'lane/framework-core-lifecycle/wu-1627',
        mergeRetries: 2,
      }),
    ).rejects.toThrow('Atomic merge failed after 2 attempts');

    expect(h.shared.pushRefspecWithRetry).not.toHaveBeenCalled();
    expect(h.mainGit.merge).not.toHaveBeenCalled();
    expect(h.shared.cleanupMicroWorktree).toHaveBeenCalledTimes(1);
  });

  it('keeps live main untouched on push failure', async () => {
    const h = setupHarness();
    h.shared.pushRefspecWithRetry.mockRejectedValue(new Error('push failed'));

    const mod = await import(ATOMIC_MERGE_MODULE);
    await expect(
      mod.withAtomicMerge({
        id: 'WU-1627',
        laneBranch: 'lane/framework-core-lifecycle/wu-1627',
      }),
    ).rejects.toThrow('push failed');

    expect(h.mainGit.merge).not.toHaveBeenCalled();
    expect(h.shared.cleanupMicroWorktree).toHaveBeenCalledTimes(1);
  });

  it('formats retry-exhaustion failures with actionable command guidance', async () => {
    const h = setupHarness();
    h.shared.pushRefspecWithRetry.mockRejectedValue(
      new Error('Push failed after 3 attempts. Origin main moved.'),
    );

    const mod = await import(ATOMIC_MERGE_MODULE);
    await expect(
      mod.withAtomicMerge({
        id: 'WU-1627',
        laneBranch: 'lane/framework-core-lifecycle/wu-1627',
      }),
    ).rejects.toThrow('Next steps');

    expect(h.shared.formatRetryExhaustionError).toHaveBeenCalled();
    expect(h.mainGit.merge).not.toHaveBeenCalled();
  });

  it('keeps live main untouched on callback failure and still cleans up temp artifacts', async () => {
    const h = setupHarness();
    const afterMerge = vi.fn().mockRejectedValue(new Error('callback failed'));

    const mod = await import(ATOMIC_MERGE_MODULE);
    await expect(
      mod.withAtomicMerge({
        id: 'WU-1627',
        laneBranch: 'lane/framework-core-lifecycle/wu-1627',
        afterMerge,
      }),
    ).rejects.toThrow('callback failed');

    expect(h.shared.pushRefspecWithRetry).not.toHaveBeenCalled();
    expect(h.mainGit.merge).not.toHaveBeenCalled();
    expect(h.shared.cleanupMicroWorktree).toHaveBeenCalledTimes(1);
  });

  it('executes afterMerge callback with temp-worktree context', async () => {
    const h = setupHarness();
    const afterMerge = vi.fn().mockResolvedValue(undefined);

    const mod = await import(ATOMIC_MERGE_MODULE);
    await mod.withAtomicMerge({
      id: 'WU-1627',
      laneBranch: 'lane/framework-core-lifecycle/wu-1627',
      afterMerge,
    });

    expect(afterMerge).toHaveBeenCalledWith({
      worktreePath: '/tmp/wu-done-abc123',
      gitWorktree: h.gitWorktree,
      tempBranchName: 'tmp/wu-done/wu-1627',
    });
  });

  it('includes operation name in push description for branch-only traceability', async () => {
    const h = setupHarness();
    const mod = await import(ATOMIC_MERGE_MODULE);

    await mod.withAtomicMerge({
      id: 'WU-1629',
      laneBranch: 'lane/framework-core-lifecycle/wu-1629',
      operation: 'wu-done-branch-only',
    });

    expect(h.shared.pushRefspecWithRetry).toHaveBeenCalledWith(
      h.gitWorktree,
      h.mainGit,
      'origin',
      'tmp/wu-done/wu-1627',
      'main',
      'wu-done-branch-only atomic merge push for WU-1629 (automated)',
      '[wu-done]',
    );
  });
});
