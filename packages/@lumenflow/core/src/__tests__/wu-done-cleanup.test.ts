/**
 * WU-1492: Tests for wu-done-cleanup branch-pr mode handling
 *
 * Validates that cleanup logic treats branch-pr as PR-mode:
 * - Worktree is preserved (not removed) for branch-pr WUs
 * - Existing worktree-pr cleanup behavior is unchanged
 * - Default worktree mode still removes worktree
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock all external dependencies before imports
const mockGit = {
  worktreeRemove: vi.fn(),
  deleteBranch: vi.fn(),
  raw: vi.fn(),
  fetch: vi.fn(),
};

vi.mock('../git-adapter.js', () => ({
  getGitForCwd: () => mockGit,
}));

vi.mock('../cleanup-lock.js', () => ({
  withCleanupLock: vi.fn((_id, fn) => fn()),
}));

vi.mock('../worktree-ownership.js', () => ({
  validateWorktreeOwnership: vi.fn(() => ({ valid: true })),
}));

vi.mock('../cleanup-install-config.js', () => ({
  getCleanupInstallConfig: vi.fn(() => ({
    command: 'echo test',
    timeout: 5000,
    env: {},
  })),
  CLEANUP_INSTALL_TIMEOUT_MS: 30000,
}));

vi.mock('../wu-done-paths.js', () => ({
  defaultWorktreeFrom: vi.fn(() => 'worktrees/framework-core-wu-1492'),
  defaultBranchFrom: vi.fn(() => 'lane/framework-core/wu-1492'),
  branchExists: vi.fn(() => true),
}));

vi.mock('../wu-done-branch-utils.js', () => ({
  isBranchAlreadyMerged: vi.fn(() => true),
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    existsSync: vi.fn(() => true),
  };
});

vi.mock('node:child_process', () => ({
  exec: vi.fn((_cmd, _opts, cb) => cb(null, '', '')),
}));

vi.mock('node:util', async () => {
  const actual = await vi.importActual('node:util');
  return {
    ...actual,
    promisify: () => vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
  };
});

import { runCleanup } from '../wu-done-cleanup.js';
import { isBranchAlreadyMerged } from '../wu-done-branch-utils.js';

describe('wu-done-cleanup branch-pr handling (WU-1492)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('preserves worktree for branch-pr mode (treats as PR-mode)', async () => {
    const doc = {
      id: 'WU-1492',
      lane: 'Framework: Core',
      claimed_mode: 'branch-pr',
    };
    const args = {};

    await runCleanup(doc, args);

    // Worktree should NOT be removed in branch-pr mode
    expect(mockGit.worktreeRemove).not.toHaveBeenCalled();

    // Should log the PR-mode preservation message
    const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
    expect(logCalls).toContain('PR mode');
  });

  it('preserves worktree for worktree-pr mode (existing behavior unchanged)', async () => {
    const doc = {
      id: 'WU-1492',
      lane: 'Framework: Core',
      claimed_mode: 'worktree-pr',
    };
    const args = {};

    await runCleanup(doc, args);

    // Worktree should NOT be removed in worktree-pr mode
    expect(mockGit.worktreeRemove).not.toHaveBeenCalled();
  });

  it('removes worktree for default worktree mode (existing behavior unchanged)', async () => {
    const doc = {
      id: 'WU-1492',
      lane: 'Framework: Core',
      claimed_mode: 'worktree',
    };
    const args = {};

    await runCleanup(doc, args);

    // Worktree SHOULD be removed in default worktree mode
    expect(mockGit.worktreeRemove).toHaveBeenCalled();
  });

  it('retries local branch deletion with force when remote main already contains the branch', async () => {
    vi.mocked(isBranchAlreadyMerged).mockResolvedValue(false);
    mockGit.deleteBranch.mockRejectedValueOnce(new Error('not fully merged'));
    mockGit.deleteBranch.mockResolvedValueOnce(undefined);
    mockGit.raw.mockResolvedValue('');

    const doc = {
      id: 'WU-1657',
      lane: 'Framework: Core Lifecycle',
      claimed_mode: 'worktree',
    };

    await runCleanup(doc, {});

    expect(mockGit.deleteBranch).toHaveBeenCalledTimes(2);
    expect(mockGit.deleteBranch).toHaveBeenNthCalledWith(1, 'lane/framework-core/wu-1492', {
      force: false,
    });
    expect(mockGit.deleteBranch).toHaveBeenNthCalledWith(2, 'lane/framework-core/wu-1492', {
      force: true,
    });
  });
});
