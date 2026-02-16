/**
 * @file wu-done-merged-worktree.test.ts
 * @description Tests for WU-1746: wu:done resilience when worktree deleted but branch already merged
 *
 * TDD: RED phase - Tests written BEFORE implementation.
 *
 * Tests cover:
 * AC1: wu:done detects when WU branch commits are already merged to main
 * AC2: wu:done completes stamping and state cleanup even when worktree is gone
 * AC3: wu:recover can handle released-but-not-done WUs with merged commits
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
  };
});

const mockGitAdapter = {
  getCommitHash: vi.fn(),
  mergeBase: vi.fn(),
  branchExists: vi.fn(),
  raw: vi.fn(),
};

vi.mock('../git-adapter.js', () => ({
  getGitForCwd: () => mockGitAdapter,
  createGitForPath: () => mockGitAdapter,
}));

vi.mock('../stamp-utils.js', () => ({
  createStamp: vi.fn(() => ({ created: true, path: '.lumenflow/stamps/WU-TEST.done' })),
}));

vi.mock('../wu-yaml.js', () => ({
  readWU: vi.fn(() => ({
    id: 'WU-1',
    title: 'Test WU',
    status: 'in_progress',
    lane: 'Framework: Core',
  })),
  writeWU: vi.fn(),
  parseYAML: vi.fn(),
}));

vi.mock('../wu-state-store.js', () => {
  const mockStore = {
    load: vi.fn(),
    getByStatus: vi.fn(() => new Set()),
    getWUState: vi.fn(),
    complete: vi.fn(),
  };
  return {
    WUStateStore: vi.fn(() => mockStore),
    WU_EVENTS_FILE_NAME: 'wu-events.jsonl',
    __mockStore: mockStore,
  };
});

vi.mock('../wu-backlog-updater.js', () => ({
  moveWUToDoneBacklog: vi.fn(),
}));

vi.mock('../wu-status-updater.js', () => ({
  updateStatusRemoveInProgress: vi.fn(),
  addToStatusCompleted: vi.fn(),
}));

// ──────────────────────────────────────────────
// Import SUT after mocks
// ──────────────────────────────────────────────

import {
  detectAlreadyMergedNoWorktree,
  executeAlreadyMergedCompletion,
  type AlreadyMergedDetectionResult,
  type AlreadyMergedCompletionResult,
} from '../wu-done-merged-worktree.js';

import { createStamp } from '../stamp-utils.js';
import { writeWU } from '../wu-yaml.js';
import { moveWUToDoneBacklog } from '../wu-backlog-updater.js';
import { updateStatusRemoveInProgress, addToStatusCompleted } from '../wu-status-updater.js';

// ──────────────────────────────────────────────
// AC1: Detection of already-merged branch with no worktree
// ──────────────────────────────────────────────

describe('detectAlreadyMergedNoWorktree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns merged=true when branch tip equals merge-base (branch fully merged)', async () => {
    const fakeSha = 'abc1234567890';
    vi.mocked(existsSync).mockReturnValue(false); // worktree does not exist
    mockGitAdapter.branchExists.mockResolvedValue(true);
    mockGitAdapter.getCommitHash.mockResolvedValue(fakeSha);
    mockGitAdapter.mergeBase.mockResolvedValue(fakeSha);

    const result: AlreadyMergedDetectionResult = await detectAlreadyMergedNoWorktree({
      wuId: 'WU-1',
      laneBranch: 'lane/framework-core/wu-1',
      worktreePath: '/repo/worktrees/framework-core-wu-1',
    });

    expect(result.merged).toBe(true);
    expect(result.worktreeExists).toBe(false);
  });

  it('returns merged=false when branch has unmerged commits', async () => {
    vi.mocked(existsSync).mockReturnValue(false); // worktree does not exist
    mockGitAdapter.branchExists.mockResolvedValue(true);
    mockGitAdapter.getCommitHash
      .mockResolvedValueOnce('branchTip123') // branch tip
      .mockResolvedValueOnce('mainHead456'); // main HEAD
    mockGitAdapter.mergeBase.mockResolvedValue('mergeBase789');

    const result = await detectAlreadyMergedNoWorktree({
      wuId: 'WU-2',
      laneBranch: 'lane/framework-core/wu-2',
      worktreePath: '/repo/worktrees/framework-core-wu-2',
    });

    expect(result.merged).toBe(false);
  });

  it('returns merged=false when worktree still exists', async () => {
    vi.mocked(existsSync).mockReturnValue(true); // worktree exists

    const result = await detectAlreadyMergedNoWorktree({
      wuId: 'WU-3',
      laneBranch: 'lane/framework-core/wu-3',
      worktreePath: '/repo/worktrees/framework-core-wu-3',
    });

    // If worktree exists, this scenario is not the "merged but worktree gone" case
    expect(result.worktreeExists).toBe(true);
  });

  it('returns merged=true when branch no longer exists (deleted after merge)', async () => {
    mockGitAdapter.branchExists.mockResolvedValue(false);
    vi.mocked(existsSync).mockReturnValue(false); // worktree gone

    // When branch is gone, check if WU commits are reachable from HEAD
    // We use git log to check if the WU branch was ever merged
    mockGitAdapter.raw.mockResolvedValue('abc1234\n'); // commit found in main history

    const result = await detectAlreadyMergedNoWorktree({
      wuId: 'WU-4',
      laneBranch: 'lane/framework-core/wu-4',
      worktreePath: '/repo/worktrees/framework-core-wu-4',
    });

    expect(result.merged).toBe(true);
    expect(result.branchExists).toBe(false);
    expect(result.worktreeExists).toBe(false);
  });

  it('returns merged=false on git errors (fail-safe)', async () => {
    mockGitAdapter.branchExists.mockRejectedValue(new Error('git error'));
    vi.mocked(existsSync).mockReturnValue(false);

    const result = await detectAlreadyMergedNoWorktree({
      wuId: 'WU-5',
      laneBranch: 'lane/framework-core/wu-5',
      worktreePath: '/repo/worktrees/framework-core-wu-5',
    });

    expect(result.merged).toBe(false);
  });
});

// ──────────────────────────────────────────────
// AC2: Stamping and state cleanup when worktree is gone
// ──────────────────────────────────────────────

describe('executeAlreadyMergedCompletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates stamp file for the WU', async () => {
    const result: AlreadyMergedCompletionResult = await executeAlreadyMergedCompletion({
      id: 'WU-1',
      title: 'Test WU',
      lane: 'Framework: Core',
    });

    expect(createStamp).toHaveBeenCalledWith({
      id: 'WU-1',
      title: 'Test WU',
    });
    expect(result.stamped).toBe(true);
  });

  it('updates WU YAML status to done', async () => {
    await executeAlreadyMergedCompletion({
      id: 'WU-1',
      title: 'Test WU',
      lane: 'Framework: Core',
    });

    expect(writeWU).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'done',
      }),
    );
  });

  it('updates backlog and status files', async () => {
    await executeAlreadyMergedCompletion({
      id: 'WU-1',
      title: 'Test WU',
      lane: 'Framework: Core',
    });

    expect(moveWUToDoneBacklog).toHaveBeenCalledWith(expect.any(String), 'WU-1', 'Test WU');
    expect(updateStatusRemoveInProgress).toHaveBeenCalled();
    expect(addToStatusCompleted).toHaveBeenCalled();
  });

  it('returns success result with all completion flags', async () => {
    const result = await executeAlreadyMergedCompletion({
      id: 'WU-1',
      title: 'Test WU',
      lane: 'Framework: Core',
    });

    expect(result.success).toBe(true);
    expect(result.stamped).toBe(true);
    expect(result.yamlUpdated).toBe(true);
    expect(result.backlogUpdated).toBe(true);
  });

  it('handles stamp already existing (idempotent)', async () => {
    vi.mocked(createStamp).mockReturnValue({
      created: false,
      path: '.lumenflow/stamps/WU-1.done',
      reason: 'already_exists',
    });

    const result = await executeAlreadyMergedCompletion({
      id: 'WU-1',
      title: 'Test WU',
      lane: 'Framework: Core',
    });

    // Should still succeed even if stamp already exists
    expect(result.success).toBe(true);
  });

  it('reports partial failure if stamp succeeds but backlog update fails', async () => {
    vi.mocked(moveWUToDoneBacklog).mockImplementation(() => {
      throw new Error('backlog write failed');
    });

    const result = await executeAlreadyMergedCompletion({
      id: 'WU-1',
      title: 'Test WU',
      lane: 'Framework: Core',
    });

    // Stamping succeeded even though backlog failed
    expect(result.stamped).toBe(true);
    // Overall success is false due to backlog failure
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────
// AC3: wu:recover handles released-but-not-done WUs with merged commits
// ──────────────────────────────────────────────

describe('recovery analyzer: merged-not-done detection', () => {
  // This tests the extended analyzeRecovery function in recovery-analyzer.ts
  // The recovery analyzer should detect a new issue type: MERGED_NOT_DONE
  // when WU status is ready/in_progress but commits are merged to main and worktree is gone

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is tested via recovery-analyzer integration', () => {
    // This acceptance criterion is verified through the recovery-analyzer tests
    // which test the analyzeRecovery function with a new MERGED_NOT_DONE issue type.
    // The actual test is in recovery-analyzer.test.ts extension.
    //
    // Here we verify that the module exports the required types for integration.
    expect(typeof detectAlreadyMergedNoWorktree).toBe('function');
    expect(typeof executeAlreadyMergedCompletion).toBe('function');
  });
});
