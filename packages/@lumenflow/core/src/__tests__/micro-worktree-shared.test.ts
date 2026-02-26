// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SHARED_MODULE = '../micro-worktree-shared.js';
const GIT_ADAPTER_MODULE = '../git-adapter.js';
const CONFIG_MODULE = '../lumenflow-config.js';

function makeWorktreeList(path: string, branch: string): string {
  return `worktree ${path}\nHEAD 0123456789\nbranch refs/heads/${branch}\n`;
}

describe('micro-worktree-shared', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should merge retry config with correct precedence', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const resolved = mod.resolvePushRetryConfig(
      { retries: 5, min_delay_ms: 200 },
      { retries: 7, jitter: false },
    );

    expect(resolved).toEqual({
      enabled: true,
      retries: 7,
      min_delay_ms: 200,
      max_delay_ms: 1000,
      jitter: false,
    });

    const defaultsOnly = mod.resolvePushRetryConfig(undefined, undefined);
    expect(defaultsOnly).toEqual(mod.DEFAULT_PUSH_RETRY_CONFIG);

    expect(mod.MAX_MERGE_RETRIES).toBe(3);
    expect(mod.MAX_PUSH_RETRIES).toBe(3);
  });

  it('should evaluate requireRemote correctly', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({
      getConfig: vi.fn().mockReturnValue({ git: { requireRemote: false } }),
    }));

    const mod = await import(SHARED_MODULE);
    expect(mod.shouldSkipRemoteOperations()).toBe(true);

    vi.resetModules();
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({
      getConfig: vi.fn().mockReturnValue({ git: { requireRemote: true } }),
    }));

    const mod2 = await import(SHARED_MODULE);
    expect(mod2.shouldSkipRemoteOperations()).toBe(false);
  });

  it('should build temp branch and create worktree dir', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    expect(mod.getTempBranchName('wu-create', 'WU-123')).toBe('tmp/wu-create/wu-123');

    const dir = mod.createMicroWorktreeDir('wu-test-');
    expect(dir).toContain('wu-test-');
    expect(existsSync(dir)).toBe(true);
  });

  it('should find worktree by branch and return null when missing', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const list = [
      'worktree /tmp/wt-1',
      'HEAD abc',
      'branch refs/heads/tmp/wu-create/wu-1',
      '',
      'worktree /tmp/wt-2',
      'HEAD def',
      'branch refs/heads/tmp/wu-create/wu-2',
    ].join('\n');

    expect(mod.findWorktreeByBranch(list, 'tmp/wu-create/wu-2')).toBe('/tmp/wt-2');
    expect(mod.findWorktreeByBranch(list, 'tmp/wu-create/wu-3')).toBeNull();
  });

  it('should detect and cleanup orphaned worktree and branch', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const orphanPath = '/tmp/wu-orphan-1';
    const tempBranch = 'tmp/wu-create/wu-321';
    const gitAdapter = {
      worktreeList: vi.fn().mockResolvedValue(makeWorktreeList(orphanPath, tempBranch)),
      worktreeRemove: vi.fn().mockResolvedValue(undefined),
      branchExists: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof mod.cleanupOrphanedMicroWorktree>[2];

    const result = await mod.cleanupOrphanedMicroWorktree('wu-create', 'WU-321', gitAdapter, '[t]');

    expect(result).toEqual({ cleanedWorktree: true, cleanedBranch: true });
    expect((gitAdapter.worktreeRemove as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      orphanPath,
    );
    expect((gitAdapter.deleteBranch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(tempBranch);
  });

  it('should fallback to filesystem cleanup when worktree remove fails', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const orphanPath = mkdtempSync(join(tmpdir(), 'wu-orphan-fallback-'));
    const tempBranch = 'tmp/wu-edit/wu-654';

    const gitAdapter = {
      worktreeList: vi.fn().mockResolvedValue(makeWorktreeList(orphanPath, tempBranch)),
      worktreeRemove: vi.fn().mockRejectedValue(new Error('remove failed')),
      branchExists: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof mod.cleanupOrphanedMicroWorktree>[2];

    const result = await mod.cleanupOrphanedMicroWorktree('wu-edit', 'WU-654', gitAdapter, '[t]');

    expect(result).toEqual({ cleanedWorktree: true, cleanedBranch: false });
    expect(existsSync(orphanPath)).toBe(false);
  });

  it('should tolerate list and branch cleanup errors in orphan cleanup', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const gitAdapter = {
      worktreeList: vi.fn().mockRejectedValue(new Error('list failed')),
      worktreeRemove: vi.fn(),
      branchExists: vi.fn().mockRejectedValue(new Error('branch check failed')),
      deleteBranch: vi.fn(),
    } as unknown as Parameters<typeof mod.cleanupOrphanedMicroWorktree>[2];

    const result = await mod.cleanupOrphanedMicroWorktree('wu-create', 'WU-999', gitAdapter, '[t]');

    expect(result).toEqual({ cleanedWorktree: false, cleanedBranch: false });
  });

  it('should return no cleanup when no orphan worktree path matches', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const gitAdapter = {
      worktreeList: vi
        .fn()
        .mockResolvedValue(makeWorktreeList('/tmp/other-worktree', 'tmp/wu-create/wu-other')),
      worktreeRemove: vi.fn(),
      branchExists: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn(),
    } as unknown as Parameters<typeof mod.cleanupOrphanedMicroWorktree>[2];

    const result = await mod.cleanupOrphanedMicroWorktree('wu-create', 'WU-903', gitAdapter, '[t]');
    expect(result).toEqual({ cleanedWorktree: false, cleanedBranch: false });
  });

  it('should handle non-Error values in orphan cleanup catches', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const gitAdapter = {
      worktreeList: vi.fn().mockRejectedValue('list-string'),
      worktreeRemove: vi.fn(),
      branchExists: vi.fn().mockRejectedValue('branch-string'),
      deleteBranch: vi.fn(),
    } as unknown as Parameters<typeof mod.cleanupOrphanedMicroWorktree>[2];

    const result = await mod.cleanupOrphanedMicroWorktree('wu-create', 'WU-904', gitAdapter, '[t]');
    expect(result).toEqual({ cleanedWorktree: false, cleanedBranch: false });
  });

  it('should cleanup expected and registered worktrees plus branch', async () => {
    const expected = mkdtempSync(join(tmpdir(), 'wu-cleanup-expected-'));
    const registered = mkdtempSync(join(tmpdir(), 'wu-cleanup-registered-'));
    const branch = 'tmp/wu-create/wu-777';

    const mainGit = {
      worktreeRemove: vi.fn().mockResolvedValue(undefined),
      worktreeList: vi.fn().mockResolvedValue(makeWorktreeList(registered, branch)),
      branchExists: vi.fn().mockResolvedValue(true),
      deleteBranch: vi.fn().mockResolvedValue(undefined),
    };

    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn().mockReturnValue(mainGit) }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    await mod.cleanupMicroWorktree(expected, branch, '[t]');

    expect(mainGit.worktreeRemove).toHaveBeenCalledTimes(2);
    expect(mainGit.worktreeRemove).toHaveBeenNthCalledWith(1, expected, { force: true });
    expect(mainGit.worktreeRemove).toHaveBeenNthCalledWith(2, registered, { force: true });
    expect(mainGit.deleteBranch).toHaveBeenCalledWith(branch, { force: true });
  });

  it('should use injected main git adapter for cleanup without getGitForCwd', async () => {
    const expected = mkdtempSync(join(tmpdir(), 'wu-cleanup-injected-'));
    const branch = 'tmp/wu-create/wu-2204';

    const injectedMainGit = {
      worktreeRemove: vi.fn().mockResolvedValue(undefined),
      worktreeList: vi.fn().mockResolvedValue(''),
      branchExists: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn(),
    };

    vi.doMock(GIT_ADAPTER_MODULE, () => ({
      getGitForCwd: vi.fn(() => {
        throw new Error('getGitForCwd should not be called when adapter is injected');
      }),
    }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    await mod.cleanupMicroWorktree(expected, branch, '[t]', injectedMainGit as never);

    expect(injectedMainGit.worktreeRemove).toHaveBeenCalledTimes(1);
    expect(injectedMainGit.worktreeRemove).toHaveBeenCalledWith(expected, { force: true });
  });

  it('should tolerate cleanup errors and fallback for expected path', async () => {
    const expected = mkdtempSync(join(tmpdir(), 'wu-cleanup-fallback-'));
    const branch = 'tmp/wu-create/wu-888';

    const mainGit = {
      worktreeRemove: vi.fn().mockRejectedValue(new Error('cannot remove via git')),
      worktreeList: vi.fn().mockRejectedValue(new Error('cannot list')),
      branchExists: vi.fn().mockRejectedValue(new Error('cannot check branch')),
      deleteBranch: vi.fn(),
    };

    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn().mockReturnValue(mainGit) }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    await mod.cleanupMicroWorktree(expected, branch, '[t]');

    expect(existsSync(expected)).toBe(false);
    expect(mainGit.deleteBranch).not.toHaveBeenCalled();
  });

  it('should cover non-Error cleanup branches and equal registered-path no-op', async () => {
    const expected = mkdtempSync(join(tmpdir(), 'wu-cleanup-nonerror-'));
    const branch = 'tmp/wu-create/wu-901';

    const mainGit = {
      worktreeRemove: vi.fn().mockRejectedValue('remove-string'),
      worktreeList: vi.fn().mockResolvedValue(makeWorktreeList(expected, branch)),
      branchExists: vi.fn().mockRejectedValue('branch-string'),
      deleteBranch: vi.fn(),
    };

    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn().mockReturnValue(mainGit) }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    await mod.cleanupMicroWorktree(expected, branch, '[t]');

    expect(existsSync(expected)).toBe(false);
    expect(mainGit.worktreeRemove).toHaveBeenCalledTimes(1);
    expect(mainGit.deleteBranch).not.toHaveBeenCalled();
  });

  it('should cover skip-path branch and orphan fallback when filesystem path is missing', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn().mockReturnValue(undefined) }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const missingPath = '/tmp/wu-missing-path-never-created';
    const branch = 'tmp/wu-create/wu-902';
    const mainGit = {
      worktreeRemove: vi.fn(),
      worktreeList: vi.fn().mockResolvedValue(''),
      branchExists: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn(),
    };

    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn().mockReturnValue(mainGit) }));
    vi.resetModules();
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn().mockReturnValue(mainGit) }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod2 = await import(SHARED_MODULE);
    await mod2.cleanupMicroWorktree(missingPath, branch, '[t]');
    expect(mainGit.worktreeRemove).not.toHaveBeenCalled();

    const orphanGit = {
      worktreeList: vi.fn().mockResolvedValue(makeWorktreeList(missingPath, branch)),
      worktreeRemove: vi.fn().mockRejectedValue('remove-string'),
      branchExists: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn(),
    } as unknown as Parameters<typeof mod2.cleanupOrphanedMicroWorktree>[2];

    const result = await mod2.cleanupOrphanedMicroWorktree('wu-create', 'WU-902', orphanGit, '[t]');
    expect(result).toEqual({ cleanedWorktree: true, cleanedBranch: false });
  });

  it('should handle non-Error list failures in registered worktree cleanup', async () => {
    const branch = 'tmp/wu-create/wu-905';
    const mainGit = {
      worktreeRemove: vi.fn(),
      worktreeList: vi.fn().mockRejectedValue('list-string'),
      branchExists: vi.fn().mockResolvedValue(false),
      deleteBranch: vi.fn(),
    };

    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn().mockReturnValue(mainGit) }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);
    await mod.cleanupMicroWorktree('/tmp/non-existent-905', branch, '[t]');
    expect(mainGit.deleteBranch).not.toHaveBeenCalled();
  });

  it('should handle RetryExhaustionError helpers', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const typed = new mod.RetryExhaustionError('op-name', 4);
    const legacy = new Error('Push failed after 2 attempts. Origin main moved.');
    const normal = new Error('other error');

    expect(mod.isRetryExhaustionError(typed)).toBe(true);
    expect(mod.isRetryExhaustionError(legacy)).toBe(true);
    expect(mod.isRetryExhaustionError(normal)).toBe(false);
    expect(mod.isRetryExhaustionError('bad')).toBe(false);

    const formatted = mod.formatRetryExhaustionError(typed, {
      command: 'pnpm wu:done --id WU-123',
    });

    expect(formatted).toContain('Push failed after 4 attempts');
    expect(formatted).toContain('pnpm wu:done --id WU-123');
  });

  it('should push refspec with force and restore env vars on success and failure', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    process.env.LUMENFLOW_FORCE = 'orig-force';
    process.env.LUMENFLOW_FORCE_REASON = 'orig-reason';

    const successGit = {
      pushRefspec: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof mod.pushRefspecWithForce>[0];

    await mod.pushRefspecWithForce(successGit, 'origin', 'tmp/a', 'main', 'test reason');

    expect(process.env.LUMENFLOW_FORCE).toBe('orig-force');
    expect(process.env.LUMENFLOW_FORCE_REASON).toBe('orig-reason');

    const failureGit = {
      pushRefspec: vi.fn().mockRejectedValue(new Error('push failed')),
    } as unknown as Parameters<typeof mod.pushRefspecWithForce>[0];

    await expect(
      mod.pushRefspecWithForce(failureGit, 'origin', 'tmp/a', 'main', 'test reason'),
    ).rejects.toThrow('push failed');

    expect(process.env.LUMENFLOW_FORCE).toBe('orig-force');
    expect(process.env.LUMENFLOW_FORCE_REASON).toBe('orig-reason');

    Reflect.deleteProperty(process.env, 'LUMENFLOW_FORCE');
    Reflect.deleteProperty(process.env, 'LUMENFLOW_FORCE_REASON');

    const noEnvGit = {
      pushRefspec: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof mod.pushRefspecWithForce>[0];

    await mod.pushRefspecWithForce(noEnvGit, 'origin', 'tmp/a', 'main', 'test reason');

    expect(process.env.LUMENFLOW_FORCE).toBeUndefined();
    expect(process.env.LUMENFLOW_FORCE_REASON).toBeUndefined();
  });

  it('should retry refspec push and throw typed exhaustion error when retries end', async () => {
    vi.doMock(GIT_ADAPTER_MODULE, () => ({ getGitForCwd: vi.fn() }));
    vi.doMock(CONFIG_MODULE, () => ({ getConfig: vi.fn().mockReturnValue({ git: {} }) }));

    const mod = await import(SHARED_MODULE);

    const gitWorktree = {
      pushRefspec: vi
        .fn()
        .mockRejectedValueOnce(new Error('race'))
        .mockResolvedValueOnce(undefined),
      rebase: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof mod.pushRefspecWithRetry>[0];

    const mainGit = {
      fetch: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof mod.pushRefspecWithRetry>[1];

    await mod.pushRefspecWithRetry(
      gitWorktree,
      mainGit,
      'origin',
      'tmp/wu-create/wu-1',
      'main',
      'reason',
      '[t]',
      { enabled: true, retries: 2, min_delay_ms: 1, max_delay_ms: 1, jitter: false },
    );

    expect((mainGit.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);
    expect((gitWorktree.rebase as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);

    const alwaysFailWorktree = {
      pushRefspec: vi.fn().mockRejectedValue(new Error('still racing')),
      rebase: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof mod.pushRefspecWithRetry>[0];

    await expect(
      mod.pushRefspecWithRetry(
        alwaysFailWorktree,
        mainGit,
        'origin',
        'tmp/wu-create/wu-1',
        'main',
        'reason',
        '[t]',
        { enabled: true, retries: 1, min_delay_ms: 1, max_delay_ms: 1, jitter: false },
      ),
    ).rejects.toThrow('Push failed after 1 attempts');

    const retryDisabledSuccessWorktree = {
      pushRefspec: vi.fn().mockResolvedValue(undefined),
      rebase: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof mod.pushRefspecWithRetry>[0];

    await mod.pushRefspecWithRetry(
      retryDisabledSuccessWorktree,
      mainGit,
      'origin',
      'tmp/wu-create/wu-1',
      'main',
      'reason',
      '[t]',
      { enabled: false, retries: 1, min_delay_ms: 1, max_delay_ms: 1, jitter: false },
    );

    await expect(
      mod.pushRefspecWithRetry(
        alwaysFailWorktree,
        mainGit,
        'origin',
        'tmp/wu-create/wu-1',
        'main',
        'reason',
        '[t]',
        { enabled: false, retries: 1, min_delay_ms: 1, max_delay_ms: 1, jitter: false },
      ),
    ).rejects.toThrow('still racing');
  });
});
