import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { computeWUEventsContentWithMainMerge } from '../wu-done-concurrent-merge.js';
import { resolveWorktreeMetadataPaths } from '../wu-done-worktree.js';

const TEST_WU_ID = 'WU-999991';

describe('wu:done worktree metadata path isolation', () => {
  let worktreeRoot = '';

  beforeEach(() => {
    worktreeRoot = mkdtempSync(join(tmpdir(), 'wu-done-worktree-'));

    mkdirSync(join(worktreeRoot, 'docs', '04-operations', 'tasks'), { recursive: true });
    mkdirSync(join(worktreeRoot, '.lumenflow', 'state'), { recursive: true });

    writeFileSync(
      join(worktreeRoot, 'docs', '04-operations', 'tasks', 'backlog.md'),
      '# Backlog\n',
    );
    writeFileSync(
      join(worktreeRoot, '.lumenflow', 'state', 'wu-events.jsonl'),
      `${JSON.stringify({
        type: 'claim',
        wuId: TEST_WU_ID,
        lane: 'Framework: Core Lifecycle',
        title: 'Test claim',
        timestamp: '2026-02-10T00:00:00.000Z',
      })}\n`,
      'utf-8',
    );
  });

  afterEach(() => {
    if (worktreeRoot) {
      rmSync(worktreeRoot, { recursive: true, force: true });
    }
  });

  it('resolves metadata and state paths as absolute worktree-local paths', () => {
    const paths = resolveWorktreeMetadataPaths(worktreeRoot, TEST_WU_ID);

    expect(paths.wuPath.startsWith(worktreeRoot)).toBe(true);
    expect(paths.statusPath.startsWith(worktreeRoot)).toBe(true);
    expect(paths.backlogPath.startsWith(worktreeRoot)).toBe(true);
    expect(paths.stampsDir.startsWith(worktreeRoot)).toBe(true);
    expect(paths.stampPath.startsWith(worktreeRoot)).toBe(true);
    expect(paths.eventsPath.startsWith(worktreeRoot)).toBe(true);
  });

  it('returns wu-events content that appends a complete event for the completed WU', async () => {
    const paths = resolveWorktreeMetadataPaths(worktreeRoot, TEST_WU_ID);

    const eventsUpdate = await computeWUEventsContentWithMainMerge(paths.backlogPath, TEST_WU_ID);

    expect(eventsUpdate).not.toBeNull();
    expect(eventsUpdate?.eventsPath).toBe(paths.eventsPath);

    const lines = eventsUpdate!.content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    const lastEvent = JSON.parse(lines[lines.length - 1]) as { type?: string; wuId?: string };

    expect(lastEvent.type).toBe('complete');
    expect(lastEvent.wuId).toBe(TEST_WU_ID);
  });

  it('returns no wu-events update when rerun sees the WU already completed', async () => {
    const eventsPath = join(worktreeRoot, '.lumenflow', 'state', 'wu-events.jsonl');
    writeFileSync(
      eventsPath,
      `${JSON.stringify({
        type: 'claim',
        wuId: TEST_WU_ID,
        lane: 'Framework: Core Lifecycle',
        title: 'Test claim',
        timestamp: '2026-02-10T00:00:00.000Z',
      })}\n` +
        `${JSON.stringify({
          type: 'complete',
          wuId: TEST_WU_ID,
          timestamp: '2026-02-10T00:05:00.000Z',
        })}\n`,
      'utf-8',
    );

    const paths = resolveWorktreeMetadataPaths(worktreeRoot, TEST_WU_ID);
    const eventsUpdate = await computeWUEventsContentWithMainMerge(paths.backlogPath, TEST_WU_ID);

    expect(eventsUpdate).toBeNull();
  });
});

describe('wu:done cleanup fallback determinism (WU-1658)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadCleanupHarness(options: { remoteContainsBranch: boolean }) {
    const laneBranch = 'lane/framework-core-state-recovery/wu-1658';
    const mockGit = {
      worktreeRemove: vi.fn(),
      deleteBranch: vi.fn(),
      raw: vi.fn(),
      fetch: vi.fn().mockResolvedValue(undefined),
    };

    mockGit.deleteBranch.mockRejectedValueOnce(new Error('not fully merged'));
    if (options.remoteContainsBranch) {
      mockGit.deleteBranch.mockResolvedValueOnce(undefined);
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'merge-base') {
          return '';
        }
        return '';
      });
    } else {
      mockGit.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'merge-base') {
          throw new Error('not ancestor');
        }
        return '';
      });
    }

    vi.doMock('../git-adapter.js', () => ({
      getGitForCwd: () => mockGit,
    }));
    vi.doMock('../cleanup-lock.js', () => ({
      withCleanupLock: vi.fn(async (_id, fn) => fn()),
    }));
    vi.doMock('../worktree-ownership.js', () => ({
      validateWorktreeOwnership: vi.fn(() => ({ valid: true })),
    }));
    vi.doMock('../wu-done-paths.js', () => ({
      defaultWorktreeFrom: vi.fn(async () => 'worktrees/framework-core-state-recovery-wu-1658'),
      defaultBranchFrom: vi.fn(async () => laneBranch),
      branchExists: vi.fn(async () => true),
    }));
    vi.doMock('../wu-done-branch-utils.js', () => ({
      isBranchAlreadyMerged: vi.fn(async () => false),
    }));
    vi.doMock('node:fs', async () => {
      const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
      return {
        ...actual,
        existsSync: vi.fn(() => false),
      };
    });

    const { runCleanup } = await import('../wu-done-cleanup.js');

    return {
      laneBranch,
      mockGit,
      runCleanup,
    };
  }

  it('force-deletes local branch when remote main already contains merged branch', async () => {
    const { laneBranch, mockGit, runCleanup } = await loadCleanupHarness({
      remoteContainsBranch: true,
    });

    await runCleanup(
      {
        id: 'WU-1658',
        lane: 'Framework: Core State Recovery',
        claimed_mode: 'worktree',
      },
      {},
    );

    expect(mockGit.deleteBranch).toHaveBeenCalledTimes(2);
    expect(mockGit.deleteBranch).toHaveBeenNthCalledWith(1, laneBranch, { force: false });
    expect(mockGit.deleteBranch).toHaveBeenNthCalledWith(2, laneBranch, { force: true });
  });

  it('does not force-delete when remote main does not contain the branch', async () => {
    const { laneBranch, mockGit, runCleanup } = await loadCleanupHarness({
      remoteContainsBranch: false,
    });

    await runCleanup(
      {
        id: 'WU-1658',
        lane: 'Framework: Core State Recovery',
        claimed_mode: 'worktree',
      },
      {},
    );

    expect(mockGit.deleteBranch).toHaveBeenCalledTimes(1);
    expect(mockGit.deleteBranch).toHaveBeenCalledWith(laneBranch, { force: false });
  });
});

// ---------------------------------------------------------------------------
// WU-1665: State-machine-driven recovery consolidation
// ---------------------------------------------------------------------------

describe('WU-1665: state-machine-driven rollback and recovery', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('StateMachineRecoveryManager', () => {
    it('should export StateMachineRecoveryManager from wu-recovery', async () => {
      const mod = await import('../wu-recovery.js');
      expect(typeof mod.StateMachineRecoveryManager).toBe('function');
    });

    it('should create a manager from a pipeline snapshot', async () => {
      const { StateMachineRecoveryManager } = await import('../wu-recovery.js');
      const manager = new StateMachineRecoveryManager({
        wuId: 'WU-1665',
        failedAt: 'committing',
        error: 'Git commit error',
        retryCount: 0,
      });

      expect(manager.wuId).toBe('WU-1665');
      expect(manager.failedAt).toBe('committing');
    });

    it('should determine rollback scope based on failedAt state', async () => {
      const { StateMachineRecoveryManager } = await import('../wu-recovery.js');

      // Failed at validating: no rollback needed (nothing was written)
      const validating = new StateMachineRecoveryManager({
        wuId: 'WU-100',
        failedAt: 'validating',
        error: 'bad yaml',
        retryCount: 0,
      });
      expect(validating.getRollbackScope()).toEqual({
        snapshotRestore: false,
        branchRollback: false,
        worktreeCleanup: false,
      });

      // Failed at committing: need snapshot restore (files were written)
      const committing = new StateMachineRecoveryManager({
        wuId: 'WU-100',
        failedAt: 'committing',
        error: 'git commit failed',
        retryCount: 0,
      });
      expect(committing.getRollbackScope()).toEqual({
        snapshotRestore: true,
        branchRollback: false,
        worktreeCleanup: false,
      });

      // Failed at pushing: need branch rollback + snapshot restore
      const pushing = new StateMachineRecoveryManager({
        wuId: 'WU-100',
        failedAt: 'pushing',
        error: 'push rejected',
        retryCount: 0,
      });
      expect(pushing.getRollbackScope()).toEqual({
        snapshotRestore: true,
        branchRollback: true,
        worktreeCleanup: false,
      });

      // Failed at cleaningUp: worktree cleanup partial (post-push)
      const cleaningUp = new StateMachineRecoveryManager({
        wuId: 'WU-100',
        failedAt: 'cleaningUp',
        error: 'worktree removal failed',
        retryCount: 0,
      });
      expect(cleaningUp.getRollbackScope()).toEqual({
        snapshotRestore: false,
        branchRollback: false,
        worktreeCleanup: true,
      });
    });

    it('should serialize and deserialize recovery state', async () => {
      const { StateMachineRecoveryManager } = await import('../wu-recovery.js');
      const manager = new StateMachineRecoveryManager({
        wuId: 'WU-1665',
        failedAt: 'merging',
        error: 'non-ff merge',
        retryCount: 2,
      });

      const serialized = manager.serialize();
      const deserialized = StateMachineRecoveryManager.deserialize(serialized);

      expect(deserialized.wuId).toBe('WU-1665');
      expect(deserialized.failedAt).toBe('merging');
      expect(deserialized.error).toBe('non-ff merge');
      expect(deserialized.retryCount).toBe(2);
    });
  });

  describe('Legacy rollback compatibility guard', () => {
    it('should export LUMENFLOW_LEGACY_ROLLBACK_ENV_KEY constant', async () => {
      const mod = await import('../wu-recovery.js');
      expect(mod.LUMENFLOW_LEGACY_ROLLBACK_ENV_KEY).toBe('LUMENFLOW_LEGACY_ROLLBACK');
    });

    it('should use legacy path when LUMENFLOW_LEGACY_ROLLBACK=1', async () => {
      const mod = await import('../wu-recovery.js');
      expect(typeof mod.isLegacyRollbackEnabled).toBe('function');

      // Default: legacy disabled
      const original = process.env.LUMENFLOW_LEGACY_ROLLBACK;
      delete process.env.LUMENFLOW_LEGACY_ROLLBACK;
      expect(mod.isLegacyRollbackEnabled()).toBe(false);

      // Enabled
      process.env.LUMENFLOW_LEGACY_ROLLBACK = '1';
      expect(mod.isLegacyRollbackEnabled()).toBe(true);

      // Restore
      if (original !== undefined) {
        process.env.LUMENFLOW_LEGACY_ROLLBACK = original;
      } else {
        delete process.env.LUMENFLOW_LEGACY_ROLLBACK;
      }
    });
  });

  describe('Snapshot-based restore via transaction', () => {
    it('should export executeSnapshotRestore from wu-transaction', async () => {
      const mod = await import('../wu-transaction.js');
      expect(typeof mod.executeSnapshotRestore).toBe('function');
    });

    it('should restore files from serialized snapshot data', async () => {
      const fs = await import('node:fs');
      const pathMod = await import('node:path');
      const osMod = await import('node:os');
      const { executeSnapshotRestore } = await import('../wu-transaction.js');

      const tempDir = fs.mkdtempSync(pathMod.join(osMod.tmpdir(), 'snapshot-test-'));
      try {
        const filePath = pathMod.join(tempDir, 'test.txt');
        fs.writeFileSync(filePath, 'original content', 'utf-8');

        // Build a snapshot map directly (simulate what createTransactionSnapshot produces)
        const snapshot = new Map<string, string | null>([[filePath, 'original content']]);

        // Modify file (simulates partial transaction commit)
        fs.writeFileSync(filePath, 'modified content', 'utf-8');
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('modified content');

        // Restore from snapshot
        const result = executeSnapshotRestore(snapshot);

        expect(result.errors.length).toBe(0);
        expect(result.restored.length).toBe(1);
        expect(fs.readFileSync(filePath, 'utf-8')).toBe('original content');
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('Centralized rollback entry point', () => {
    it('should export rollbackFromPipelineState from rollback-utils', async () => {
      const mod = await import('../rollback-utils.js');
      expect(typeof mod.rollbackFromPipelineState).toBe('function');
    });

    it('should use the state-machine scope to determine rollback actions', async () => {
      const { rollbackFromPipelineState, RollbackResult } = await import('../rollback-utils.js');

      // For validating failures: no-op rollback
      const validatingResult = rollbackFromPipelineState({
        failedAt: 'validating',
        snapshot: null,
        filesToRestore: [],
      });
      expect(validatingResult).toBeInstanceOf(RollbackResult);
      expect(validatingResult.success).toBe(true);
      expect(validatingResult.restored.length).toBe(0);
    });
  });
});
