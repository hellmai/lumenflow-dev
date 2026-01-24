/**
 * @file wu-recover.test.ts
 * Tests for wu:recover CLI command (WU-1090)
 *
 * TDD: RED phase - Tests written BEFORE implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CONTEXT_VALIDATION, WU_STATUS } from '@lumenflow/core/dist/wu-constants.js';
import type { WuContext } from '@lumenflow/core/dist/validation/types.js';
import type { RecoveryAnalysis } from '@lumenflow/core/dist/recovery/recovery-analyzer.js';

const { LOCATION_TYPES, RECOVERY_ISSUES, RECOVERY_ACTIONS } = CONTEXT_VALIDATION;

describe('wu:recover CLI (WU-1090)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
