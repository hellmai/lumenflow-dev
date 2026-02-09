import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ensureCleanWorktree } from '../wu-done-check.js';
import { checkPostMergeDirtyState, computeBranchOnlyFallback } from '../wu-done.js';
import * as gitAdapter from '@lumenflow/core/git-adapter';
import * as errorHandler from '@lumenflow/core/error-handler';
import { validateInputs } from '@lumenflow/core/wu-done-inputs';

// Mock dependencies
vi.mock('@lumenflow/core/git-adapter');
vi.mock('@lumenflow/core/error-handler');

describe('wu-done', () => {
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

  describe('WU-1515: checkPostMergeDirtyState internal churn handling', () => {
    it('does not block when only internal lifecycle files are dirty', () => {
      const status = [' M .lumenflow/flow.log', ' M .lumenflow/skip-gates-audit.log'].join('\n');
      const result = checkPostMergeDirtyState(status, 'WU-1515');
      expect(result.isDirty).toBe(false);
      expect(result.internalOnlyFiles).toEqual([
        '.lumenflow/flow.log',
        '.lumenflow/skip-gates-audit.log',
      ]);
      expect(result.unrelatedFiles).toEqual([]);
    });

    it('blocks when unrelated files are dirty, even if internal files are also dirty', () => {
      const status = [' M .lumenflow/flow.log', ' M packages/@lumenflow/cli/src/wu-done.ts'].join(
        '\n',
      );
      const result = checkPostMergeDirtyState(status, 'WU-1515');
      expect(result.isDirty).toBe(true);
      expect(result.unrelatedFiles).toEqual(['packages/@lumenflow/cli/src/wu-done.ts']);
    });
  });

  describe('WU-1522: flow.log does not block wu:done post-merge', () => {
    it('does not block when only flow.log is dirty after merge', () => {
      const status = ' M .lumenflow/flow.log\n';
      const result = checkPostMergeDirtyState(status, 'WU-1522');
      expect(result.isDirty).toBe(false);
      expect(result.internalOnlyFiles).toContain('.lumenflow/flow.log');
    });

    it('does not block when flow.log is untracked after merge', () => {
      const status = '?? .lumenflow/flow.log\n';
      const result = checkPostMergeDirtyState(status, 'WU-1522');
      expect(result.isDirty).toBe(false);
      expect(result.internalOnlyFiles).toContain('.lumenflow/flow.log');
    });

    it('handles flow.log with skip-cos-gates-audit.log together', () => {
      const status = [' M .lumenflow/flow.log', ' M .lumenflow/skip-cos-gates-audit.log'].join(
        '\n',
      );
      const result = checkPostMergeDirtyState(status, 'WU-1522');
      expect(result.isDirty).toBe(false);
      expect(result.internalOnlyFiles).toHaveLength(2);
    });

    it('is consistent between pre-merge and post-merge handling', () => {
      // Both validateDirtyMain (pre-merge) and checkPostMergeDirtyState (post-merge)
      // must allow flow.log. This test validates the post-merge side.
      // The pre-merge side is tested in wu-done-dirty-main.test.ts WU-1522 section.
      const status = ' M .lumenflow/flow.log\n';
      const result = checkPostMergeDirtyState(status, 'WU-1522');
      expect(result.isDirty).toBe(false);
      // flow.log should be classified as internal, not unrelated
      expect(result.unrelatedFiles).not.toContain('.lumenflow/flow.log');
    });
  });

  describe('WU-1554: metadata files do not block wu:done post-merge', () => {
    const TASK_DIR = 'docs/04-operations/tasks';

    it('classifies .lumenflow/state/ files as metadataFiles', () => {
      const status = 'M  .lumenflow/state/wu-events.jsonl\n';
      const result = checkPostMergeDirtyState(status, 'WU-1554', TASK_DIR);
      expect(result.isDirty).toBe(false);
      expect(result.metadataFiles).toEqual(['.lumenflow/state/wu-events.jsonl']);
      expect(result.unrelatedFiles).toEqual([]);
    });

    it('classifies task directory files as metadataFiles', () => {
      const status = [
        ' M docs/04-operations/tasks/backlog.md',
        ' M docs/04-operations/tasks/status.md',
        ' M docs/04-operations/tasks/wu/WU-1554.yaml',
      ].join('\n');
      const result = checkPostMergeDirtyState(status, 'WU-1554', TASK_DIR);
      expect(result.isDirty).toBe(false);
      expect(result.metadataFiles).toEqual([
        'docs/04-operations/tasks/backlog.md',
        'docs/04-operations/tasks/status.md',
        'docs/04-operations/tasks/wu/WU-1554.yaml',
      ]);
      expect(result.unrelatedFiles).toEqual([]);
    });

    it('classifies .lumenflow/stamps/ files as metadataFiles', () => {
      const status = ' M .lumenflow/stamps/WU-1554.done\n';
      const result = checkPostMergeDirtyState(status, 'WU-1554', TASK_DIR);
      expect(result.isDirty).toBe(false);
      expect(result.metadataFiles).toContain('.lumenflow/stamps/WU-1554.done');
    });

    it('classifies .lumenflow/archive/ files as metadataFiles', () => {
      const status = ' M .lumenflow/archive/wu-events-2026-02.jsonl\n';
      const result = checkPostMergeDirtyState(status, 'WU-1554', TASK_DIR);
      expect(result.isDirty).toBe(false);
      expect(result.metadataFiles).toContain('.lumenflow/archive/wu-events-2026-02.jsonl');
    });

    it('does not block when mixed metadata and internal lifecycle files are dirty', () => {
      const status = [
        ' M .lumenflow/flow.log',
        'M  .lumenflow/state/wu-events.jsonl',
        ' M docs/04-operations/tasks/status.md',
      ].join('\n');
      const result = checkPostMergeDirtyState(status, 'WU-1554', TASK_DIR);
      expect(result.isDirty).toBe(false);
      expect(result.internalOnlyFiles).toContain('.lumenflow/flow.log');
      expect(result.metadataFiles).toContain('.lumenflow/state/wu-events.jsonl');
      expect(result.metadataFiles).toContain('docs/04-operations/tasks/status.md');
    });

    it('still blocks when unrelated files are dirty alongside metadata files', () => {
      const status = [
        ' M .lumenflow/state/wu-events.jsonl',
        ' M packages/@lumenflow/cli/src/some-file.ts',
      ].join('\n');
      const result = checkPostMergeDirtyState(status, 'WU-1554', TASK_DIR);
      expect(result.isDirty).toBe(true);
      expect(result.metadataFiles).toContain('.lumenflow/state/wu-events.jsonl');
      expect(result.unrelatedFiles).toEqual(['packages/@lumenflow/cli/src/some-file.ts']);
    });

    it('backward-compatible: works without metadataDir parameter', () => {
      // Without metadataDir, .lumenflow/ files still classified as metadata
      // but task dir files are classified as unrelated (backward compat)
      const status = 'M  .lumenflow/state/wu-events.jsonl\n';
      const result = checkPostMergeDirtyState(status, 'WU-1554');
      expect(result.isDirty).toBe(false);
      expect(result.metadataFiles).toContain('.lumenflow/state/wu-events.jsonl');
    });

    it('returns empty metadataFiles when no metadata files are dirty', () => {
      const status = ' M .lumenflow/flow.log\n';
      const result = checkPostMergeDirtyState(status, 'WU-1554', TASK_DIR);
      expect(result.metadataFiles).toEqual([]);
    });
  });
});
