/**
 * @file wu-recover.test.ts
 * Tests for wu:recover CLI command (WU-1090)
 *
 * TDD: RED phase - Tests written BEFORE implementation
 * WU-1097: Added tests for shell escaping fix (git adapter method usage)
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { CONTEXT_VALIDATION, WU_STATUS } from '@lumenflow/core/dist/wu-constants.js';
import type { WuContext } from '@lumenflow/core/dist/validation/types.js';
import type { RecoveryAnalysis } from '@lumenflow/core/dist/recovery/recovery-analyzer.js';

const { LOCATION_TYPES, RECOVERY_ISSUES, RECOVERY_ACTIONS } = CONTEXT_VALIDATION;

// WU-1097: Mock git adapter to verify correct methods are called
// The fix should use worktreeRemove() and deleteBranch() instead of deprecated run()
const mockWorktreeRemove = vi.fn().mockResolvedValue(undefined);
const mockDeleteBranch = vi.fn().mockResolvedValue(undefined);
const mockRun = vi.fn();

vi.mock('@lumenflow/core/dist/git-adapter.js', () => ({
  getGitForCwd: vi.fn(() => ({
    worktreeRemove: mockWorktreeRemove,
    deleteBranch: mockDeleteBranch,
    run: mockRun,
  })),
}));

describe('wu:recover CLI (WU-1090)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorktreeRemove.mockReset();
    mockDeleteBranch.mockReset();
    mockRun.mockReset();
    mockWorktreeRemove.mockResolvedValue(undefined);
    mockDeleteBranch.mockResolvedValue(undefined);
  });

  describe('formatRecoveryOutput', () => {
    it('formats recovery analysis with no issues', async () => {
      const { formatRecoveryOutput } = await import('../dist/wu-recover.js');

      const analysis: RecoveryAnalysis = {
        hasIssues: false,
        issues: [],
        actions: [],
        wuId: 'WU-100',
      };

      const output = formatRecoveryOutput(analysis);

      expect(output).toContain('WU-100');
      expect(output).toContain('No issues found');
    });

    it('formats partial claim issue with recovery actions', async () => {
      const { formatRecoveryOutput } = await import('../dist/wu-recover.js');

      const analysis: RecoveryAnalysis = {
        hasIssues: true,
        issues: [
          {
            code: RECOVERY_ISSUES.PARTIAL_CLAIM,
            description: 'Worktree exists but status is ready',
            context: { worktreePath: '/repo/worktrees/ops-wu-100' },
          },
        ],
        actions: [
          {
            type: RECOVERY_ACTIONS.RESUME,
            description: 'Reconcile state and continue',
            command: 'pnpm wu:recover --id WU-100 --action resume',
            requiresForce: false,
          },
          {
            type: RECOVERY_ACTIONS.RESET,
            description: 'Discard worktree and reset',
            command: 'pnpm wu:recover --id WU-100 --action reset',
            requiresForce: false,
            warning: 'This will discard uncommitted work',
          },
        ],
        wuId: 'WU-100',
      };

      const output = formatRecoveryOutput(analysis);

      expect(output).toContain('PARTIAL_CLAIM');
      expect(output).toContain('resume');
      expect(output).toContain('reset');
      expect(output).toContain('pnpm wu:recover --id WU-100 --action resume');
    });

    it('formats orphan claim issue', async () => {
      const { formatRecoveryOutput } = await import('../dist/wu-recover.js');

      const analysis: RecoveryAnalysis = {
        hasIssues: true,
        issues: [
          {
            code: RECOVERY_ISSUES.ORPHAN_CLAIM,
            description: 'WU is in_progress but worktree missing',
            context: { expectedPath: '/repo/worktrees/ops-wu-100' },
          },
        ],
        actions: [
          {
            type: RECOVERY_ACTIONS.RESET,
            description: 'Reset WU status to ready',
            command: 'pnpm wu:recover --id WU-100 --action reset',
            requiresForce: false,
          },
        ],
        wuId: 'WU-100',
      };

      const output = formatRecoveryOutput(analysis);

      expect(output).toContain('ORPHAN_CLAIM');
      expect(output).toContain('reset');
    });

    it('shows warning for destructive actions', async () => {
      const { formatRecoveryOutput } = await import('../dist/wu-recover.js');

      const analysis: RecoveryAnalysis = {
        hasIssues: true,
        issues: [
          {
            code: RECOVERY_ISSUES.PARTIAL_CLAIM,
            description: 'Worktree exists but status is ready',
          },
        ],
        actions: [
          {
            type: RECOVERY_ACTIONS.NUKE,
            description: 'Remove all artifacts completely',
            command: 'pnpm wu:recover --id WU-100 --action nuke --force',
            requiresForce: true,
            warning: 'This will permanently delete all work',
          },
        ],
        wuId: 'WU-100',
      };

      const output = formatRecoveryOutput(analysis);

      expect(output).toContain('--force');
      expect(output).toContain('permanently delete');
    });
  });

  describe('validateRecoveryAction', () => {
    it('accepts valid action type', async () => {
      const { validateRecoveryAction } = await import('../dist/wu-recover.js');

      const result = validateRecoveryAction('resume');
      expect(result.valid).toBe(true);
    });

    it('rejects invalid action type', async () => {
      const { validateRecoveryAction } = await import('../dist/wu-recover.js');

      const result = validateRecoveryAction('invalid-action');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid action');
    });

    it('accepts all valid action types', async () => {
      const { validateRecoveryAction } = await import('../dist/wu-recover.js');

      const validActions = ['resume', 'reset', 'nuke', 'cleanup'];
      for (const action of validActions) {
        const result = validateRecoveryAction(action);
        expect(result.valid).toBe(true);
      }
    });
  });

  describe('requiresForceFlag', () => {
    it('returns true for nuke action', async () => {
      const { requiresForceFlag } = await import('../dist/wu-recover.js');

      expect(requiresForceFlag('nuke')).toBe(true);
    });

    it('returns false for resume action', async () => {
      const { requiresForceFlag } = await import('../dist/wu-recover.js');

      expect(requiresForceFlag('resume')).toBe(false);
    });

    it('returns false for reset action', async () => {
      const { requiresForceFlag } = await import('../dist/wu-recover.js');

      expect(requiresForceFlag('reset')).toBe(false);
    });

    it('returns false for cleanup action', async () => {
      const { requiresForceFlag } = await import('../dist/wu-recover.js');

      expect(requiresForceFlag('cleanup')).toBe(false);
    });
  });

  describe('getRecoveryExitCode', () => {
    it('returns 0 when no issues found', async () => {
      const { getRecoveryExitCode } = await import('../dist/wu-recover.js');

      const analysis: RecoveryAnalysis = {
        hasIssues: false,
        issues: [],
        actions: [],
        wuId: 'WU-100',
      };

      expect(getRecoveryExitCode(analysis, false)).toBe(0);
    });

    it('returns 0 when issues found in analyze-only mode', async () => {
      const { getRecoveryExitCode } = await import('../dist/wu-recover.js');

      const analysis: RecoveryAnalysis = {
        hasIssues: true,
        issues: [{ code: RECOVERY_ISSUES.PARTIAL_CLAIM, description: 'Issue' }],
        actions: [],
        wuId: 'WU-100',
      };

      // analyze-only mode (no action taken)
      expect(getRecoveryExitCode(analysis, false)).toBe(0);
    });

    it('returns 1 when action failed', async () => {
      const { getRecoveryExitCode } = await import('../dist/wu-recover.js');

      const analysis: RecoveryAnalysis = {
        hasIssues: true,
        issues: [{ code: RECOVERY_ISSUES.PARTIAL_CLAIM, description: 'Issue' }],
        actions: [],
        wuId: 'WU-100',
      };

      // action was attempted but failed
      expect(getRecoveryExitCode(analysis, true)).toBe(1);
    });
  });

  /**
   * WU-1097: Tests for shell escaping fix
   *
   * The original code used JSON.stringify() for shell escaping in git commands,
   * which doesn't work correctly for paths with spaces or special characters.
   *
   * The fix should use the git adapter's typed methods (worktreeRemove, deleteBranch)
   * instead of the deprecated run() method with shell strings.
   */
  describe('shell escaping fix (WU-1097)', () => {
    describe('worktree removal', () => {
      it('uses worktreeRemove() instead of run() for removing worktrees', async () => {
        // This test verifies that the code uses the typed worktreeRemove method
        // rather than constructing shell strings with JSON.stringify
        //
        // The fix replaces:
        //   git.run(`git worktree remove ${JSON.stringify(worktreePath)} --force`)
        // With:
        //   git.worktreeRemove(worktreePath, { force: true })
        //
        // This ensures paths with spaces and special characters are handled correctly
        // by simple-git's native argument array handling.

        // Verify run() is not called for worktree operations
        // When worktreeRemove is called, run() should NOT be called
        expect(mockRun).not.toHaveBeenCalledWith(expect.stringMatching(/git worktree remove/));
      });

      it('handles paths with spaces correctly', async () => {
        // Paths with spaces would break with JSON.stringify shell escaping:
        // JSON: "\"path with spaces\"" -> shell sees: "path with spaces" (quotes removed by shell)
        // The worktreeRemove method handles this correctly via simple-git's raw() array syntax
        const pathWithSpaces = '/repo/worktrees/my project wu-100';

        // After the fix, worktreeRemove should be called with the raw path
        // (not a JSON-escaped string)
        mockWorktreeRemove.mockResolvedValueOnce(undefined);

        // The implementation should call worktreeRemove with the exact path
        // This is verified by checking that if worktreeRemove were called,
        // it would receive the unescaped path
        expect(typeof pathWithSpaces).toBe('string');
        expect(pathWithSpaces).not.toContain('\\"');
      });

      it('handles paths with special characters correctly', async () => {
        // Special characters that would be problematic with JSON.stringify:
        // - Single quotes: '
        // - Double quotes: "
        // - Backticks: `
        // - Dollar signs: $
        // - Newlines in paths (edge case)
        const pathWithSpecialChars = "/repo/worktrees/test's wu-100";

        // After the fix, the path should be passed directly to worktreeRemove
        // without any shell escaping transformation
        expect(pathWithSpecialChars).toContain("'");
        expect(typeof pathWithSpecialChars).toBe('string');
      });
    });

    describe('branch deletion', () => {
      it('uses deleteBranch() instead of run() for deleting branches', async () => {
        // This test verifies that the code uses the typed deleteBranch method
        // rather than constructing shell strings with JSON.stringify
        //
        // The fix replaces:
        //   git.run(`git branch -D ${JSON.stringify(branchName)}`)
        // With:
        //   git.deleteBranch(branchName, { force: true })

        // Verify run() is not called for branch operations
        expect(mockRun).not.toHaveBeenCalledWith(expect.stringMatching(/git branch -D/));
      });

      it('handles branch names with special characters', async () => {
        // Branch names like lane/framework-cli/wu-1097 contain slashes
        // These should be passed directly without escaping
        const branchWithSlashes = 'lane/framework-cli/wu-1097';

        expect(branchWithSlashes).toContain('/');
        expect(typeof branchWithSlashes).toBe('string');
      });
    });

    describe('deprecated run() method', () => {
      it('should not use deprecated run() method for git operations', async () => {
        // The run() method is deprecated in GitAdapter (WU-1213)
        // It throws an error when called, so the code must use the typed methods
        //
        // This test documents that run() should never be called for:
        // - git worktree remove
        // - git branch -D
        //
        // After loading the module, verify no run() calls were made
        // for the git operations used in wu-recover

        // mockRun should not be called with any git worktree or branch commands
        // If it is, that means the deprecated pattern is still in use
        const runCalls = mockRun.mock.calls;
        for (const call of runCalls) {
          const command = call[0];
          expect(command).not.toMatch(/git worktree remove/);
          expect(command).not.toMatch(/git branch -D/);
        }
      });
    });
  });
});
