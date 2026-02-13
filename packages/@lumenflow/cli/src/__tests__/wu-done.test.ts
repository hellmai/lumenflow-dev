import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ensureCleanWorktree } from '../wu-done-check.js';
import { computeBranchOnlyFallback, getYamlStatusForDisplay } from '../wu-done.js';
import {
  resolveWuDonePreCommitGateDecision,
  WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS,
} from '@lumenflow/core/gates-agent-mode';
import * as gitAdapter from '@lumenflow/core/git-adapter';
import * as errorHandler from '@lumenflow/core/error-handler';
import { validateInputs } from '@lumenflow/core/wu-done-inputs';
import { WU_STATUS } from '@lumenflow/core/wu-constants';

// Mock dependencies
vi.mock('@lumenflow/core/git-adapter');
vi.mock('@lumenflow/core/error-handler');

describe('wu-done', () => {
  describe('WU-1630: post-merge dirty-main remediation removal', () => {
    it('does not retain post-merge dirty-state cleanup flow in main execution path', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).not.toContain('const postMergeStatus = await gitMain.getStatus()');
      expect(source).not.toContain('const postLifecycleStatus = await gitMain.getStatus()');
    });
  });

  describe('WU-1634: mode-execution failure messaging', () => {
    it('surfaces root error context and retry guidance before exiting', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('Mode execution failed:');
      expect(source).toContain(
        'Next step: resolve the reported error and retry: pnpm wu:done --id ${id}',
      );
    });
  });

  describe('WU-1659: pre-flight gate deduplication', () => {
    it('reuses step-0 gates and skips duplicate full-suite pre-flight run', () => {
      const decision = resolveWuDonePreCommitGateDecision({
        skipGates: false,
        fullGatesRanInCurrentRun: true,
        skippedByCheckpoint: false,
      });

      expect(decision.runPreCommitFullSuite).toBe(false);
      expect(decision.reason).toBe(WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS.REUSE_STEP_ZERO);
    });

    it('reuses checkpoint attestation when gates were skipped by valid checkpoint', () => {
      const decision = resolveWuDonePreCommitGateDecision({
        skipGates: false,
        fullGatesRanInCurrentRun: false,
        skippedByCheckpoint: true,
        checkpointId: 'ckpt-1234',
      });

      expect(decision.runPreCommitFullSuite).toBe(false);
      expect(decision.reason).toBe(WU_DONE_PRE_COMMIT_GATE_DECISION_REASONS.REUSE_CHECKPOINT);
      expect(decision.message).toContain('ckpt-1234');
    });

    it('wu-done uses the gate dedup policy before pre-flight hook validation', async () => {
      const source = await readFile(new URL('../wu-done.ts', import.meta.url), 'utf-8');
      expect(source).toContain('resolveWuDonePreCommitGateDecision');
      expect(source).toContain('preCommitGateDecision.runPreCommitFullSuite');
    });
  });

  describe('WU-1574: strict status display helper', () => {
    it('returns canonical status when YAML status is valid', () => {
      expect(getYamlStatusForDisplay(WU_STATUS.DONE)).toBe(WU_STATUS.DONE);
    });

    it('returns unknown when YAML status is invalid', () => {
      expect(getYamlStatusForDisplay(undefined)).toBe('unknown');
      expect(getYamlStatusForDisplay('bad-status')).toBe('unknown');
    });
  });

  // WU-1494: Verify --pr-draft is accepted by wu:done arg parser
  describe('--pr-draft parser/help parity (WU-1494)', () => {
    let originalArgv: string[];
    let originalExit: typeof process.exit;

    beforeEach(() => {
      originalArgv = process.argv;
      originalExit = process.exit;
      process.exit = vi.fn() as never;
    });

    afterEach(() => {
      process.argv = originalArgv;
      process.exit = originalExit;
    });

    it('should accept --pr-draft with --create-pr via validateInputs', () => {
      const argv = ['node', 'wu-done.js', '--id', 'WU-100', '--create-pr', '--pr-draft'];

      const { args, id } = validateInputs(argv);

      expect(id).toBe('WU-100');
      expect(args.createPr).toBe(true);
      expect(args.prDraft).toBe(true);
    });

    it('should accept --create-pr without --pr-draft via validateInputs', () => {
      const argv = ['node', 'wu-done.js', '--id', 'WU-200', '--create-pr'];

      const { args, id } = validateInputs(argv);

      expect(id).toBe('WU-200');
      expect(args.createPr).toBe(true);
      expect(args.prDraft).toBeUndefined();
    });
  });

  describe('ensureCleanWorktree', () => {
    let mockGit: any;

    beforeEach(() => {
      vi.resetAllMocks();
      mockGit = {
        getStatus: vi.fn(),
      };
      vi.mocked(gitAdapter.createGitForPath).mockReturnValue(mockGit);
    });

    it('should pass if worktree is clean', async () => {
      mockGit.getStatus.mockResolvedValue(''); // Clean status

      await ensureCleanWorktree('/path/to/worktree');

      expect(mockGit.getStatus).toHaveBeenCalled();
      expect(errorHandler.die).not.toHaveBeenCalled();
    });

    it('should die if worktree has uncommitted changes', async () => {
      mockGit.getStatus.mockResolvedValue('M  file.ts\n?? new-file.ts'); // Dirty status

      await ensureCleanWorktree('/path/to/worktree');

      expect(mockGit.getStatus).toHaveBeenCalled();
      expect(errorHandler.die).toHaveBeenCalledWith(
        expect.stringContaining('Worktree has uncommitted changes'),
      );
    });

    it('should use the correct worktree path', async () => {
      mockGit.getStatus.mockResolvedValue('');

      await ensureCleanWorktree('/custom/worktree/path');

      expect(gitAdapter.createGitForPath).toHaveBeenCalledWith('/custom/worktree/path');
    });
  });

  describe('WU-1492: computeBranchOnlyFallback with branch-pr', () => {
    it('does not treat branch-pr as branch-only', () => {
      const result = computeBranchOnlyFallback({
        isBranchOnly: false,
        branchOnlyRequested: false,
        worktreeExists: false,
        derivedWorktree: null,
      });

      expect(result.effectiveBranchOnly).toBe(false);
    });

    it('branch-only remains effective when isBranchOnly is true', () => {
      const result = computeBranchOnlyFallback({
        isBranchOnly: true,
        branchOnlyRequested: false,
        worktreeExists: false,
        derivedWorktree: null,
      });

      expect(result.effectiveBranchOnly).toBe(true);
    });

    it('allows fallback when branchOnly requested but worktree missing', () => {
      const result = computeBranchOnlyFallback({
        isBranchOnly: false,
        branchOnlyRequested: true,
        worktreeExists: false,
        derivedWorktree: 'worktrees/framework-core-wu-1492',
      });

      expect(result.allowFallback).toBe(true);
      expect(result.effectiveBranchOnly).toBe(true);
    });
  });
});
