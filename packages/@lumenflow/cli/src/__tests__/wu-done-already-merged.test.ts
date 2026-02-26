// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * @file wu-done-already-merged.test.ts
 * @description Tests for WU-2211: wu:done --already-merged finalize-only mode
 *
 * TDD: Tests for the --already-merged flag and associated functions.
 *
 * Acceptance Criteria:
 * AC1: wu:done --already-merged --id WU-XXX skips merge phase entirely
 * AC2: Safety check verifies code_paths from YAML exist on HEAD of main
 * AC3: Stamp, completion event, backlog, and status are written via micro-worktree commit
 * AC4: Re-running is idempotent (stamp already_exists is not an error)
 * AC5: Fails with clear error if code_paths are NOT on main
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ──────────────────────────────────────────────
// Mocks
// ──────────────────────────────────────────────

const mockGitAdapter = {
  raw: vi.fn(),
  getStatus: vi.fn().mockResolvedValue(''),
  getCurrentBranch: vi.fn().mockResolvedValue('main'),
  branchExists: vi.fn(),
  getCommitHash: vi.fn(),
  mergeBase: vi.fn(),
  add: vi.fn(),
  addWithDeletions: vi.fn(),
  commit: vi.fn(),
};

vi.mock('@lumenflow/core/git-adapter', () => ({
  getGitForCwd: () => mockGitAdapter,
  createGitForPath: () => mockGitAdapter,
}));

const mockWithMicroWorktree = vi.fn();

vi.mock('@lumenflow/core/micro-worktree', () => ({
  withMicroWorktree: (...args: unknown[]) => mockWithMicroWorktree(...args),
}));

const mockCollectMetadataToTransaction = vi.fn();

vi.mock('@lumenflow/core/wu-done-metadata', () => ({
  collectMetadataToTransaction: (...args: unknown[]) =>
    mockCollectMetadataToTransaction(...args),
}));

vi.mock('@lumenflow/core/wu-transaction', () => {
  const mockTransaction = {
    addWrite: vi.fn(),
    getPendingWrites: vi.fn().mockReturnValue([]),
    commit: vi.fn(),
    size: 0,
  };
  return {
    WUTransaction: function WUTransaction() {
      return mockTransaction;
    },
  };
});

vi.mock('@lumenflow/core/wu-paths', () => ({
  WU_PATHS: {
    WU: (id: string) => `docs/04-operations/tasks/wu/${id}.yaml`,
    STATUS: () => 'docs/04-operations/tasks/status.md',
    BACKLOG: () => 'docs/04-operations/tasks/backlog.md',
    STAMP: (id: string) => `.lumenflow/stamps/${id}.done`,
  },
}));

vi.mock('@lumenflow/core/error-handler', () => ({
  getErrorMessage: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  die: vi.fn((msg: string) => {
    throw new Error(msg);
  }),
  createError: vi.fn(),
  ErrorCodes: {},
}));

// ──────────────────────────────────────────────
// Import SUT modules after mocks
// ──────────────────────────────────────────────

import {
  verifyCodePathsOnMainHead,
  executeAlreadyMergedFinalize,
  type CodePathVerificationResult,
} from '../wu-done-already-merged.js';

// ──────────────────────────────────────────────
// AC1: --already-merged flag is recognized by arg parser
// ──────────────────────────────────────────────

describe('WU-2211: --already-merged arg parsing', () => {
  it('parseWUArgs recognizes --already-merged as a boolean flag', async () => {
    const { parseWUArgs } = await import('@lumenflow/core/arg-parser');

    const args = parseWUArgs([
      'node',
      'wu-done.ts',
      '--id',
      'WU-2211',
      '--already-merged',
    ]);

    expect(args.alreadyMerged).toBe(true);
  });

  it('parseWUArgs defaults --already-merged to undefined when not provided', async () => {
    const { parseWUArgs } = await import('@lumenflow/core/arg-parser');

    const args = parseWUArgs(['node', 'wu-done.ts', '--id', 'WU-2211']);

    expect(args.alreadyMerged).toBeUndefined();
  });

  it('--already-merged is documented in help text', async () => {
    const { validateInputs: realValidateInputs } = await import(
      '@lumenflow/core/wu-done-inputs'
    );

    let helpText = '';
    const origLog = console.log;
    console.log = (msg: string) => {
      helpText += msg;
    };

    try {
      realValidateInputs(['node', 'wu-done.ts', '--help']);
    } catch {
      // help triggers ProcessExitError, expected
    } finally {
      console.log = origLog;
    }

    expect(helpText).toContain('--already-merged');
  });
});

// ──────────────────────────────────────────────
// AC2: Safety check verifies code_paths exist on HEAD of main
// ──────────────────────────────────────────────

describe('WU-2211: verifyCodePathsOnMainHead', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns valid when all code_paths exist on HEAD', async () => {
    mockGitAdapter.raw.mockResolvedValue('100644 blob abc123\tpackages/foo.ts\n');

    const result: CodePathVerificationResult = await verifyCodePathsOnMainHead([
      'packages/foo.ts',
    ]);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('returns invalid with missing paths when code_paths are NOT on HEAD', async () => {
    mockGitAdapter.raw
      .mockResolvedValueOnce('100644 blob abc123\tpackages/foo.ts\n')
      .mockResolvedValueOnce('');

    const result = await verifyCodePathsOnMainHead([
      'packages/foo.ts',
      'packages/bar.ts',
    ]);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('packages/bar.ts');
    expect(result.missing).not.toContain('packages/foo.ts');
  });

  it('returns valid for empty code_paths array', async () => {
    const result = await verifyCodePathsOnMainHead([]);

    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('returns invalid when git ls-tree throws for a path', async () => {
    mockGitAdapter.raw.mockRejectedValue(new Error('not found'));

    const result = await verifyCodePathsOnMainHead(['packages/missing.ts']);

    expect(result.valid).toBe(false);
    expect(result.missing).toContain('packages/missing.ts');
  });

  it('uses git ls-tree with HEAD ref for each code_path', async () => {
    mockGitAdapter.raw.mockResolvedValue('100644 blob abc\tfile.ts\n');

    await verifyCodePathsOnMainHead(['packages/a.ts', 'packages/b.ts']);

    expect(mockGitAdapter.raw).toHaveBeenCalledWith([
      'ls-tree',
      'HEAD',
      '--',
      'packages/a.ts',
    ]);
    expect(mockGitAdapter.raw).toHaveBeenCalledWith([
      'ls-tree',
      'HEAD',
      '--',
      'packages/b.ts',
    ]);
  });
});

// ──────────────────────────────────────────────
// AC3: Stamp, completion event, backlog, and status are written via micro-worktree
// ──────────────────────────────────────────────

describe('WU-2211: executeAlreadyMergedFinalize', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: micro-worktree succeeds by calling the execute callback
    mockWithMicroWorktree.mockImplementation(async (opts: { execute: (ctx: { worktreePath: string }) => Promise<unknown> }) => {
      await opts.execute({ worktreePath: '/tmp/micro-worktree' });
    });
    mockCollectMetadataToTransaction.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls withMicroWorktree with pushOnly mode', async () => {
    await executeAlreadyMergedFinalize({
      id: 'WU-100',
      title: 'Test WU',
      lane: 'Framework: Core',
      doc: { id: 'WU-100', status: 'in_progress' },
    });

    expect(mockWithMicroWorktree).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'wu-done-already-merged',
        id: 'WU-100',
        pushOnly: true,
      }),
    );
  });

  it('calls collectMetadataToTransaction inside micro-worktree', async () => {
    await executeAlreadyMergedFinalize({
      id: 'WU-100',
      title: 'Test WU',
      lane: 'Framework: Core',
      doc: { id: 'WU-100', status: 'in_progress' },
    });

    expect(mockCollectMetadataToTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'WU-100',
        title: 'Test WU',
        projectRoot: '/tmp/micro-worktree',
      }),
    );
  });

  it('returns success result when micro-worktree succeeds', async () => {
    const result = await executeAlreadyMergedFinalize({
      id: 'WU-100',
      title: 'Test WU',
      lane: 'Framework: Core',
      doc: {},
    });

    expect(result.success).toBe(true);
    expect(result.stamped).toBe(true);
    expect(result.yamlUpdated).toBe(true);
    expect(result.backlogUpdated).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('returns failure result when micro-worktree fails', async () => {
    mockWithMicroWorktree.mockRejectedValue(
      new Error('Push failed: non-fast-forward'),
    );

    const result = await executeAlreadyMergedFinalize({
      id: 'WU-100',
      title: 'Test WU',
      lane: 'Framework: Core',
      doc: {},
    });

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Push failed: non-fast-forward');
  });

  it('returns failure result when collectMetadata fails', async () => {
    mockCollectMetadataToTransaction.mockRejectedValue(
      new Error('Required metadata files missing'),
    );

    // The error propagates through withMicroWorktree's execute callback
    mockWithMicroWorktree.mockImplementation(async (opts: { execute: (ctx: { worktreePath: string }) => Promise<unknown> }) => {
      await opts.execute({ worktreePath: '/tmp/micro-worktree' });
    });

    const result = await executeAlreadyMergedFinalize({
      id: 'WU-100',
      title: 'Test WU',
      lane: 'Framework: Core',
      doc: {},
    });

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

// ──────────────────────────────────────────────
// AC4: Re-running is idempotent (stamp already_exists is not an error)
// ──────────────────────────────────────────────

describe('WU-2211: idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('verifyCodePathsOnMainHead is safe to call repeatedly', async () => {
    mockGitAdapter.raw.mockResolvedValue('100644 blob abc123\tpackages/foo.ts\n');

    const result1 = await verifyCodePathsOnMainHead(['packages/foo.ts']);
    const result2 = await verifyCodePathsOnMainHead(['packages/foo.ts']);

    expect(result1.valid).toBe(true);
    expect(result2.valid).toBe(true);
  });

  it('executeAlreadyMergedFinalize succeeds on repeated calls', async () => {
    mockWithMicroWorktree.mockImplementation(async (opts: { execute: (ctx: { worktreePath: string }) => Promise<unknown> }) => {
      await opts.execute({ worktreePath: '/tmp/micro-worktree' });
    });
    mockCollectMetadataToTransaction.mockResolvedValue(undefined);

    const result1 = await executeAlreadyMergedFinalize({
      id: 'WU-100',
      title: 'Test WU',
      lane: 'Framework: Core',
      doc: {},
    });
    const result2 = await executeAlreadyMergedFinalize({
      id: 'WU-100',
      title: 'Test WU',
      lane: 'Framework: Core',
      doc: {},
    });

    expect(result1.success).toBe(true);
    expect(result2.success).toBe(true);
  });
});

// ──────────────────────────────────────────────
// AC5: Fails with clear error if code_paths are NOT on main
// ──────────────────────────────────────────────

describe('WU-2211: clear error messages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('error includes list of missing files', async () => {
    mockGitAdapter.raw.mockResolvedValue('');

    const result = await verifyCodePathsOnMainHead([
      'packages/a.ts',
      'packages/b.ts',
    ]);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('packages/a.ts');
    expect(result.error).toContain('packages/b.ts');
  });

  it('error includes instruction about not using --already-merged', async () => {
    mockGitAdapter.raw.mockResolvedValue('');

    const result = await verifyCodePathsOnMainHead(['packages/not-here.ts']);

    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('not found on HEAD');
    expect(result.error).toContain('--already-merged');
  });

  it('error includes remediation options', async () => {
    mockGitAdapter.raw.mockResolvedValue('');

    const result = await verifyCodePathsOnMainHead(['packages/not-here.ts']);

    expect(result.error).toContain('Merge the code first');
    expect(result.error).toContain('normal wu:done workflow');
    expect(result.error).toContain('Update code_paths');
  });
});
