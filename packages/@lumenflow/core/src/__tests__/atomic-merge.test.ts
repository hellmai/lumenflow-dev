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

// ---------------------------------------------------------------------------
// WU-1665: Failure-mode recovery parity tests
// ---------------------------------------------------------------------------

describe('WU-1665: failure-mode recovery parity with state-machine rollback', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should export rollbackFromPipelineState from rollback-utils for centralized recovery', async () => {
    const mod = await import('../rollback-utils.js');
    expect(typeof mod.rollbackFromPipelineState).toBe('function');
  });

  it('should produce deterministic recovery outcome for push-failure injection', async () => {
    const { rollbackFromPipelineState, RollbackResult } = await import('../rollback-utils.js');

    // Simulate push failure: files committed to worktree, push to origin failed.
    // Rollback scope: snapshot restore + branch rollback.
    const pushResult = rollbackFromPipelineState({
      failedAt: 'pushing',
      snapshot: null,
      filesToRestore: [],
    });

    expect(pushResult).toBeInstanceOf(RollbackResult);
    // Push failures after a successful commit need scope metadata indicating
    // branch rollback is required. The result captures the scope.
    expect(pushResult.scope).toBeDefined();
    expect(pushResult.scope!.branchRollback).toBe(true);
    expect(pushResult.scope!.snapshotRestore).toBe(true);
  });

  it('should produce deterministic no-op outcome for validation-failure injection', async () => {
    const { rollbackFromPipelineState, RollbackResult } = await import('../rollback-utils.js');

    // Validation failures: nothing was written, nothing to rollback
    const result = rollbackFromPipelineState({
      failedAt: 'validating',
      snapshot: null,
      filesToRestore: [],
    });

    expect(result).toBeInstanceOf(RollbackResult);
    expect(result.success).toBe(true);
    expect(result.scope).toBeDefined();
    expect(result.scope!.snapshotRestore).toBe(false);
    expect(result.scope!.branchRollback).toBe(false);
  });

  it('should produce deterministic outcome for cleanup-failure injection (post-push)', async () => {
    const { rollbackFromPipelineState } = await import('../rollback-utils.js');

    // Cleanup failures: push already succeeded, only worktree cleanup remains
    const result = rollbackFromPipelineState({
      failedAt: 'cleaningUp',
      snapshot: null,
      filesToRestore: [],
    });

    expect(result.scope).toBeDefined();
    expect(result.scope!.snapshotRestore).toBe(false);
    expect(result.scope!.branchRollback).toBe(false);
    expect(result.scope!.worktreeCleanup).toBe(true);
  });

  it('should restore files from snapshot when commit-phase rollback is needed', async () => {
    const { mkdtempSync, writeFileSync, readFileSync, rmSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const { rollbackFromPipelineState } = await import('../rollback-utils.js');

    const tempDir = mkdtempSync(join(tmpdir(), 'commit-rollback-'));
    try {
      const f1 = join(tempDir, 'a.txt');
      const f2 = join(tempDir, 'b.txt');
      writeFileSync(f1, 'original-a', 'utf-8');
      writeFileSync(f2, 'original-b', 'utf-8');

      // Snapshot before modifications
      const snapshot = new Map<string, string | null>([
        [f1, 'original-a'],
        [f2, 'original-b'],
      ]);

      // Simulate modifications (transaction commit wrote files)
      writeFileSync(f1, 'modified-a', 'utf-8');
      writeFileSync(f2, 'modified-b', 'utf-8');

      // Rollback from committing state
      const result = rollbackFromPipelineState({
        failedAt: 'committing',
        snapshot,
        filesToRestore: [
          { name: 'a.txt', path: f1, content: 'original-a' },
          { name: 'b.txt', path: f2, content: 'original-b' },
        ],
      });

      expect(result.success).toBe(true);
      expect(readFileSync(f1, 'utf-8')).toBe('original-a');
      expect(readFileSync(f2, 'utf-8')).toBe('original-b');
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
