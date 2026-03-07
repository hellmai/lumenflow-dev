// Copyright (c) 2026 Hellmai Ltd
// SPDX-License-Identifier: AGPL-3.0-only

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { executeGates, resolveCheckpointSkipResult } from '../wu-done-gates.js';

const {
  restoreExecSync,
  runGates,
  canSkipGates,
  createPreGatesCheckpoint,
  markGatesPassed,
  createGitForPath,
  runInvariants,
  die,
} = vi.hoisted(() => ({
  restoreExecSync: vi.fn(),
  runGates: vi.fn(),
  canSkipGates: vi.fn(),
  createPreGatesCheckpoint: vi.fn(),
  markGatesPassed: vi.fn(),
  createGitForPath: vi.fn(),
  runInvariants: vi.fn(),
  die: vi.fn((message: string) => {
    throw new Error(message);
  }),
}));

vi.mock('node:child_process', () => ({
  execSync: restoreExecSync,
}));

vi.mock('../gates.js', () => ({
  runGates,
}));

vi.mock('@lumenflow/core/wu-checkpoint', () => ({
  canSkipGates,
  createPreGatesCheckpoint,
  markGatesPassed,
}));

vi.mock('@lumenflow/core/git-adapter', () => ({
  createGitForPath,
}));

vi.mock('@lumenflow/core/invariants-runner', () => ({
  runInvariants,
}));

vi.mock('@lumenflow/core/error-handler', () => ({
  createError: vi.fn((code: string, message: string) => ({ code, message })),
  die,
  ErrorCodes: {
    GATES_FAILED: 'GATES_FAILED',
  },
  getErrorMessage: vi.fn((error: unknown) =>
    error instanceof Error ? error.message : String(error),
  ),
}));

vi.mock('@lumenflow/core/wu-done-ui', () => ({
  printGateFailureBox: vi.fn(),
}));

describe('WU-2342: wu-done gates checkpoint validation', () => {
  let worktreePath: string;

  beforeEach(() => {
    worktreePath = mkdtempSync(path.join(tmpdir(), 'wu-2342-gates-'));
    vi.clearAllMocks();
    createGitForPath.mockReturnValue({
      getCommitHash: vi.fn().mockResolvedValue('head-current'),
    });
    runInvariants.mockReturnValue({ success: true, formatted: '' });
    runGates.mockResolvedValue(true);
    createPreGatesCheckpoint.mockResolvedValue({ checkpointId: 'ckpt-created' });
    markGatesPassed.mockReturnValue(true);
  });

  afterEach(() => {
    rmSync(worktreePath, { recursive: true, force: true });
  });

  it('passes the current worktree HEAD SHA into checkpoint validation', async () => {
    canSkipGates.mockReturnValue({ canSkip: true, checkpoint: { checkpointId: 'ckpt-1' } });

    await resolveCheckpointSkipResult('WU-2342', worktreePath);

    expect(createGitForPath).toHaveBeenCalledWith(worktreePath);
    expect(canSkipGates).toHaveBeenCalledWith('WU-2342', {
      baseDir: worktreePath,
      currentHeadSha: 'head-current',
    });
  });

  it('does not skip gates when the checkpoint no longer matches the current HEAD', async () => {
    canSkipGates.mockImplementation((_wuId: string, options?: { currentHeadSha?: string }) => {
      if (options?.currentHeadSha === 'head-current') {
        return {
          canSkip: false,
          reason: 'Worktree has changed since checkpoint (SHA mismatch)',
        };
      }

      return {
        canSkip: true,
        checkpoint: { checkpointId: 'stale-checkpoint', gatesPassedAt: new Date().toISOString() },
      };
    });

    const result = await executeGates(
      {
        id: 'WU-2342',
        args: {},
        isBranchOnly: false,
        isDocsOnly: false,
        worktreePath,
      },
      {
        auditSkipGates: vi.fn(),
        auditSkipCosGates: vi.fn(),
        createPreGatesCheckpoint: vi.fn().mockResolvedValue(undefined),
        emitTelemetry: vi.fn(),
      },
    );

    expect(result.skippedByCheckpoint).toBe(false);
    expect(result.fullGatesRanInCurrentRun).toBe(true);
    expect(runGates).toHaveBeenCalledOnce();
  });

  it('reuses the checkpoint when HEAD still matches', async () => {
    canSkipGates.mockReturnValue({
      canSkip: true,
      checkpoint: {
        checkpointId: 'ckpt-valid',
        gatesPassedAt: '2026-03-07T12:00:00.000Z',
      },
    });

    const result = await executeGates(
      {
        id: 'WU-2342',
        args: {},
        isBranchOnly: false,
        isDocsOnly: false,
        worktreePath,
      },
      {
        auditSkipGates: vi.fn(),
        auditSkipCosGates: vi.fn(),
        createPreGatesCheckpoint: vi.fn().mockResolvedValue(undefined),
        emitTelemetry: vi.fn(),
      },
    );

    expect(result.skippedByCheckpoint).toBe(true);
    expect(result.checkpointId).toBe('ckpt-valid');
    expect(runGates).not.toHaveBeenCalled();
  });
});
