// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

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
import { validateMainNotBehindOrigin } from '../wu-done-worktree.js';

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

    const result = await validateMainNotBehindOrigin(mockGit as UnsafeAny);

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

    const result = await validateMainNotBehindOrigin(mockGit as UnsafeAny);

    expect(result.valid).toBe(false);
    expect(result.commitsBehind).toBe(3);
  });

  it('returns valid (fail-open) when fetch fails due to network error', async () => {
    const mockGit = {
      fetch: vi.fn().mockRejectedValue(new Error('network timeout')),
      getCommitHash: vi.fn(),
      revList: vi.fn(),
    };

    const result = await validateMainNotBehindOrigin(mockGit as UnsafeAny);

    expect(result.valid).toBe(true);
    expect(result.failOpen).toBe(true);
  });
});

describe('legacy rollback helper removal (AC2, AC3)', () => {
  it('does not retain rollbackMainAfterMergeFailure in worktree flow after atomic merge burn-in', async () => {
    const source = await readFile(new URL('../wu-done-worktree.ts', import.meta.url), 'utf-8');
    expect(source).not.toContain('rollbackMainAfterMergeFailure(');
  });

  it('does not include UnsafeAny placeholder text in behind-main abort messaging', async () => {
    // WU-2202: canonical ensureMainNotBehindOrigin implementation lives in sync-validator.ts
    const source = await readFile(new URL('../sync-validator.ts', import.meta.url), 'utf-8');
    expect(source).toContain('wu:done aborted BEFORE file writes to prevent metadata leaks');
    expect(source).not.toContain('wu:done aborted BEFORE UnsafeAny writes');
  });
});

describe('ensureMainNotBehindOrigin adapter injection (WU-2204)', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock('../git-adapter.js');
  });

  it('uses injected adapter without calling createGitForPath', async () => {
    const createGitForPath = vi.fn(() => {
      throw new Error('createGitForPath should not be called when adapter is injected');
    });

    vi.doMock('../git-adapter.js', () => ({
      createGitForPath,
    }));

    const mod = await import('../sync-validator.js');
    const injectedGit = {
      fetch: vi.fn().mockResolvedValue(undefined),
      getCommitHash: vi.fn().mockResolvedValue('same-sha'),
      revList: vi.fn().mockResolvedValue('0'),
    };

    await expect(
      mod.ensureMainNotBehindOrigin('/tmp/does-not-matter', 'WU-2204', {
        gitAdapterForMain: injectedGit as never,
      }),
    ).resolves.toBeUndefined();

    expect(createGitForPath).not.toHaveBeenCalled();
    expect(injectedGit.fetch).toHaveBeenCalledWith('origin', 'main');
  });
});

// ---------------------------------------------------------------------------
// AC5: worktree merge/push path uses atomic merge orchestration
// ---------------------------------------------------------------------------
describe('worktree merge orchestration (AC5)', () => {
  it('routes merge+push through withAtomicMerge and no longer wires preMainMergeSha rollback path', async () => {
    // WU-2014: merge phase extracted to wu-done-merge-phase.ts
    const source = await readFile(new URL('../wu-done-merge-phase.ts', import.meta.url), 'utf-8');

    expect(source).toContain('withAtomicMerge(');
    expect(source).not.toContain('preMainMergeSha =');
    expect(source).not.toContain('maybeRollbackMain(mainMerged');
  });
});
