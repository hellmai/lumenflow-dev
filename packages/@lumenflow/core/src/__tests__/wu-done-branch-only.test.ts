import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGit = {
  merge: vi.fn(),
  raw: vi.fn(),
  push: vi.fn(),
  commit: vi.fn(),
  add: vi.fn(),
  checkout: vi.fn(),
};

vi.mock('../git-adapter.js', () => ({
  getGitForCwd: () => mockGit,
}));

vi.mock('../wu-done-pr.js', () => ({
  createPR: vi.fn(),
  printPRCreatedMessage: vi.fn(),
  WU_DONE_COMPLETION_MODES: {
    WORKTREE: 'worktree',
    BRANCH_ONLY: 'branch-only',
    BRANCH_PR: 'branch-pr',
  },
}));

vi.mock('../wu-done-validators.js', () => ({
  defaultBranchFrom: vi.fn(),
  branchExists: vi.fn(),
  generateCommitMessage: vi.fn(() => 'wu(wu-1492): done'),
  updateMetadataFiles: vi.fn(),
  stageAndFormatMetadata: vi.fn(),
}));

import { mergeLaneBranch, executeBranchPRCompletion } from '../wu-done-branch-only.js';
import { createPR } from '../wu-done-pr.js';

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

describe('executeBranchPRCompletion', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never checks out main branch', async () => {
    const mockCreatePR = vi.mocked(createPR);
    mockCreatePR.mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/pr/1',
      ghAvailable: true,
    });
    mockGit.push.mockResolvedValue(undefined);
    mockGit.commit.mockResolvedValue(undefined);
    mockGit.add.mockResolvedValue(undefined);

    const context = {
      id: 'WU-1492',
      args: {},
      docMain: {
        id: 'WU-1492',
        lane: 'Framework: Core',
        claimed_mode: 'branch-pr',
        status: 'in_progress',
      },
      title: 'Test branch-pr',
      laneBranch: 'lane/framework-core/wu-1492',
      isDocsOnly: false,
      maxCommitLength: 100,
      validateStagedFiles: vi.fn(),
      updateMetadata: vi.fn(),
      stageMetadata: vi.fn(),
    };

    await executeBranchPRCompletion(context);

    // Must never call checkout to main
    expect(mockGit.checkout).not.toHaveBeenCalled();
  });

  it('pushes lane branch and creates PR', async () => {
    const mockCreatePR = vi.mocked(createPR);
    mockCreatePR.mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/pr/2',
      ghAvailable: true,
    });
    mockGit.push.mockResolvedValue(undefined);
    mockGit.commit.mockResolvedValue(undefined);
    mockGit.add.mockResolvedValue(undefined);

    const context = {
      id: 'WU-1492',
      args: {},
      docMain: {
        id: 'WU-1492',
        lane: 'Framework: Core',
        claimed_mode: 'branch-pr',
        status: 'in_progress',
      },
      title: 'Test branch-pr',
      laneBranch: 'lane/framework-core/wu-1492',
      isDocsOnly: false,
      maxCommitLength: 100,
      validateStagedFiles: vi.fn(),
      updateMetadata: vi.fn(),
      stageMetadata: vi.fn(),
    };

    const result = await executeBranchPRCompletion(context);

    expect(result.success).toBe(true);
    expect(result.prUrl).toBe('https://github.com/pr/2');
    expect(mockCreatePR).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: 'lane/framework-core/wu-1492',
        id: 'WU-1492',
      }),
    );
  });

  it('returns success with prUrl in result', async () => {
    const mockCreatePR = vi.mocked(createPR);
    mockCreatePR.mockResolvedValue({
      success: true,
      prUrl: 'https://github.com/pr/3',
      ghAvailable: true,
    });
    mockGit.push.mockResolvedValue(undefined);
    mockGit.commit.mockResolvedValue(undefined);
    mockGit.add.mockResolvedValue(undefined);

    const context = {
      id: 'WU-1492',
      args: {},
      docMain: {
        id: 'WU-1492',
        lane: 'Framework: Core',
        claimed_mode: 'branch-pr',
        status: 'in_progress',
      },
      title: 'Test branch-pr',
      laneBranch: 'lane/framework-core/wu-1492',
      isDocsOnly: false,
      maxCommitLength: 100,
      validateStagedFiles: vi.fn(),
      updateMetadata: vi.fn(),
      stageMetadata: vi.fn(),
    };

    const result = await executeBranchPRCompletion(context);

    expect(result).toEqual(
      expect.objectContaining({
        success: true,
        committed: true,
        pushed: true,
        merged: false,
        prUrl: 'https://github.com/pr/3',
      }),
    );
  });
});
