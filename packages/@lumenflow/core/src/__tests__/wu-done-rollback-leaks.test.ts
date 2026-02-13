/**
 * WU-1577: Tests for preventing wu:done rollback leaks on main during merge failure
 *
 * Acceptance Criteria:
 * AC1: wu:done aborts before transaction writes when local main is behind origin/main
 * AC2: on merge/rebase failure after metadata mutation, main checkout remains clean
 * AC3: failed wu:done does not leave a local complete event in wu-events.jsonl
 * AC4: idempotent retry path still succeeds after syncing main
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { validateMainNotBehindOrigin, rollbackMainAfterMergeFailure } from '../wu-done-worktree.js';

// ---------------------------------------------------------------------------
// AC1: validateMainNotBehindOrigin
// ---------------------------------------------------------------------------
describe('validateMainNotBehindOrigin (AC1)', () => {
  it('returns valid when local main matches origin/main', async () => {
    const mockGit = {
      fetch: vi.fn().mockResolvedValue(undefined),
      getCommitHash: vi.fn().mockResolvedValue('abc123'),
      revList: vi.fn().mockResolvedValue('0'),
    };

    const result = await validateMainNotBehindOrigin(mockGit as any);

    expect(result.valid).toBe(true);
    expect(result.commitsBehind).toBe(0);
  });

  it('returns invalid when local main is behind origin/main', async () => {
    const mockGit = {
      fetch: vi.fn().mockResolvedValue(undefined),
      getCommitHash: vi
        .fn()
        .mockResolvedValueOnce('local-sha') // local main
        .mockResolvedValueOnce('remote-sha'), // origin/main
      revList: vi.fn().mockResolvedValue('3'),
    };

    const result = await validateMainNotBehindOrigin(mockGit as any);

    expect(result.valid).toBe(false);
    expect(result.commitsBehind).toBe(3);
  });

  it('returns valid (fail-open) when fetch fails due to network error', async () => {
    const mockGit = {
      fetch: vi.fn().mockRejectedValue(new Error('network timeout')),
      getCommitHash: vi.fn(),
      revList: vi.fn(),
    };

    const result = await validateMainNotBehindOrigin(mockGit as any);

    expect(result.valid).toBe(true);
    expect(result.failOpen).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC2 + AC3: rollbackMainAfterMergeFailure
// ---------------------------------------------------------------------------
describe('rollbackMainAfterMergeFailure (AC2, AC3)', () => {
  it('resets main to pre-merge SHA on successful rollback', async () => {
    const mockGit = {
      reset: vi.fn().mockResolvedValue(undefined),
    };

    const result = await rollbackMainAfterMergeFailure(
      mockGit as any,
      'pre-merge-sha-abc',
      'WU-1577',
    );

    expect(result.success).toBe(true);
    expect(mockGit.reset).toHaveBeenCalledWith('pre-merge-sha-abc', { hard: true });
  });

  it('returns failure when git reset fails', async () => {
    const mockGit = {
      reset: vi.fn().mockRejectedValue(new Error('reset failed')),
    };

    const result = await rollbackMainAfterMergeFailure(
      mockGit as any,
      'pre-merge-sha-abc',
      'WU-1577',
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('reset failed');
  });

  it('does not throw even if git operations fail (best-effort)', async () => {
    const mockGit = {
      reset: vi.fn().mockRejectedValue(new Error('catastrophic failure')),
    };

    // Should not throw
    await expect(
      rollbackMainAfterMergeFailure(mockGit as any, 'sha', 'WU-1577'),
    ).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// AC5: worktree merge/push path uses atomic merge orchestration
// ---------------------------------------------------------------------------
describe('worktree merge orchestration (AC5)', () => {
  it('routes merge+push through withAtomicMerge and no longer wires preMainMergeSha rollback path', async () => {
    const source = await readFile(new URL('../wu-done-worktree.ts', import.meta.url), 'utf-8');

    expect(source).toContain('withAtomicMerge(');
    expect(source).not.toContain('preMainMergeSha =');
    expect(source).not.toContain('maybeRollbackMain(mainMerged');
  });
});
