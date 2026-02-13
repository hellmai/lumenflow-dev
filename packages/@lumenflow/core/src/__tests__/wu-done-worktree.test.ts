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
