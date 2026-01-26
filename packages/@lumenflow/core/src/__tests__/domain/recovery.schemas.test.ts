/**
 * @file recovery.schemas.test.ts
 * @description Tests for recovery-related Zod schemas
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests verify:
 * - RecoveryIssueSchema validates correctly
 * - RecoveryActionSchema validates correctly
 * - RecoveryAnalysisSchema validates correctly
 * - Types are correctly inferred from Zod schemas
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  RecoveryIssueSchema,
  RecoveryActionSchema,
  RecoveryAnalysisSchema,
  RECOVERY_ISSUE_CODE_VALUES,
  RECOVERY_ACTION_TYPE_VALUES,
  RecoveryIssueCode,
  RecoveryActionType,
  type RecoveryIssue,
  type RecoveryAction,
  type RecoveryAnalysis,
} from '../../domain/recovery.schemas.js';

// Use exported enums for test values
const RECOVERY_ISSUES = RecoveryIssueCode;
const RECOVERY_ACTIONS = RecoveryActionType;

describe('RecoveryIssueSchema', () => {
  describe('valid inputs', () => {
    it('validates partial claim issue', () => {
      const input = {
        code: RECOVERY_ISSUES.PARTIAL_CLAIM,
        description: 'Worktree exists for WU-1093 but status is ready',
        context: { worktreePath: '/repo/worktrees/test', status: 'ready' },
      };

      const result = RecoveryIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates orphan claim issue', () => {
      const input = {
        code: RECOVERY_ISSUES.ORPHAN_CLAIM,
        description: 'WU-1093 is in_progress but worktree is missing',
        context: { expectedPath: '/repo/worktrees/test', status: 'in_progress' },
      };

      const result = RecoveryIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates inconsistent state issue', () => {
      const input = {
        code: RECOVERY_ISSUES.INCONSISTENT_STATE,
        description: 'YAML says ready but state store says in_progress',
        context: { wuId: 'WU-1093' },
      };

      const result = RecoveryIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates leftover worktree issue', () => {
      const input = {
        code: RECOVERY_ISSUES.LEFTOVER_WORKTREE,
        description: 'WU-1093 is done but worktree still exists',
      };

      const result = RecoveryIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates all issue codes', () => {
      for (const code of RECOVERY_ISSUE_CODE_VALUES) {
        const input = {
          code,
          description: `Issue for ${code}`,
        };
        const result = RecoveryIssueSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });

    it('validates issue without context', () => {
      const input = {
        code: RECOVERY_ISSUES.STALE_LOCK,
        description: 'Lock file from different WU',
      };

      const result = RecoveryIssueSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects invalid issue code', () => {
      const input = {
        code: 'INVALID_CODE',
        description: 'Test',
      };

      const result = RecoveryIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing description', () => {
      const input = {
        code: RECOVERY_ISSUES.PARTIAL_CLAIM,
      };

      const result = RecoveryIssueSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('inferred type matches RecoveryIssue', () => {
      const schema: z.ZodType<RecoveryIssue> = RecoveryIssueSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('RecoveryActionSchema', () => {
  describe('valid inputs', () => {
    it('validates resume action', () => {
      const input = {
        type: RECOVERY_ACTIONS.RESUME,
        description: 'Reconcile state and continue working (preserves work)',
        command: 'pnpm wu:recover --id WU-1093 --action resume',
        requiresForce: false,
      };

      const result = RecoveryActionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates reset action with warning', () => {
      const input = {
        type: RECOVERY_ACTIONS.RESET,
        description: 'Discard worktree and reset WU to ready',
        command: 'pnpm wu:recover --id WU-1093 --action reset',
        requiresForce: false,
        warning: 'This will discard any uncommitted work in the worktree',
      };

      const result = RecoveryActionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.warning).toBeDefined();
      }
    });

    it('validates nuke action requiring force', () => {
      const input = {
        type: RECOVERY_ACTIONS.NUKE,
        description: 'Remove all artifacts completely',
        command: 'pnpm wu:recover --id WU-1093 --action nuke --force',
        requiresForce: true,
        warning: 'DANGER: This is irreversible',
      };

      const result = RecoveryActionSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.requiresForce).toBe(true);
      }
    });

    it('validates cleanup action', () => {
      const input = {
        type: RECOVERY_ACTIONS.CLEANUP,
        description: 'Remove leftover worktree for completed WU',
        command: 'pnpm wu:cleanup --id WU-1093',
        requiresForce: false,
      };

      const result = RecoveryActionSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates all action types', () => {
      for (const actionType of RECOVERY_ACTION_TYPE_VALUES) {
        const input = {
          type: actionType,
          description: `Action for ${actionType}`,
          command: `pnpm test --action ${actionType}`,
          requiresForce: false,
        };
        const result = RecoveryActionSchema.safeParse(input);
        expect(result.success).toBe(true);
      }
    });
  });

  describe('invalid inputs', () => {
    it('rejects invalid action type', () => {
      const input = {
        type: 'invalid-action',
        description: 'Test',
        command: 'test',
        requiresForce: false,
      };

      const result = RecoveryActionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects missing command', () => {
      const input = {
        type: RECOVERY_ACTIONS.RESUME,
        description: 'Test',
        requiresForce: false,
      };

      const result = RecoveryActionSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('inferred type matches RecoveryAction', () => {
      const schema: z.ZodType<RecoveryAction> = RecoveryActionSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('RecoveryAnalysisSchema', () => {
  describe('valid inputs', () => {
    it('validates analysis with issues', () => {
      const input = {
        hasIssues: true,
        issues: [
          {
            code: RECOVERY_ISSUES.PARTIAL_CLAIM,
            description: 'Worktree exists but status is ready',
          },
        ],
        actions: [
          {
            type: RECOVERY_ACTIONS.RESUME,
            description: 'Resume work',
            command: 'pnpm wu:recover --id WU-1093 --action resume',
            requiresForce: false,
          },
        ],
        wuId: 'WU-1093',
      };

      const result = RecoveryAnalysisSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.hasIssues).toBe(true);
        expect(result.data.issues).toHaveLength(1);
        expect(result.data.actions).toHaveLength(1);
      }
    });

    it('validates analysis with no issues', () => {
      const input = {
        hasIssues: false,
        issues: [],
        actions: [],
        wuId: 'WU-1093',
      };

      const result = RecoveryAnalysisSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates analysis with null wuId', () => {
      const input = {
        hasIssues: false,
        issues: [],
        actions: [],
        wuId: null,
      };

      const result = RecoveryAnalysisSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('validates analysis with multiple issues and actions', () => {
      const input = {
        hasIssues: true,
        issues: [
          {
            code: RECOVERY_ISSUES.PARTIAL_CLAIM,
            description: 'Issue 1',
          },
          {
            code: RECOVERY_ISSUES.INCONSISTENT_STATE,
            description: 'Issue 2',
          },
        ],
        actions: [
          {
            type: RECOVERY_ACTIONS.RESUME,
            description: 'Option 1',
            command: 'cmd1',
            requiresForce: false,
          },
          {
            type: RECOVERY_ACTIONS.RESET,
            description: 'Option 2',
            command: 'cmd2',
            requiresForce: false,
          },
        ],
        wuId: 'WU-1093',
      };

      const result = RecoveryAnalysisSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.issues).toHaveLength(2);
        expect(result.data.actions).toHaveLength(2);
      }
    });
  });

  describe('invalid inputs', () => {
    it('rejects missing hasIssues', () => {
      const input = {
        issues: [],
        actions: [],
        wuId: 'WU-1093',
      };

      const result = RecoveryAnalysisSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('rejects invalid issue in array', () => {
      const input = {
        hasIssues: true,
        issues: [{ code: 'INVALID', description: 'Test' }],
        actions: [],
        wuId: 'WU-1093',
      };

      const result = RecoveryAnalysisSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe('type inference', () => {
    it('inferred type matches RecoveryAnalysis', () => {
      const schema: z.ZodType<RecoveryAnalysis> = RecoveryAnalysisSchema;
      expect(schema).toBeDefined();
    });
  });
});

describe('RecoveryIssueCode enum', () => {
  it('exports PARTIAL_CLAIM constant', () => {
    expect(RecoveryIssueCode.PARTIAL_CLAIM).toBe('PARTIAL_CLAIM');
  });

  it('exports ORPHAN_CLAIM constant', () => {
    expect(RecoveryIssueCode.ORPHAN_CLAIM).toBe('ORPHAN_CLAIM');
  });

  it('exports INCONSISTENT_STATE constant', () => {
    expect(RecoveryIssueCode.INCONSISTENT_STATE).toBe('INCONSISTENT_STATE');
  });

  it('exports ORPHAN_BRANCH constant', () => {
    expect(RecoveryIssueCode.ORPHAN_BRANCH).toBe('ORPHAN_BRANCH');
  });

  it('exports STALE_LOCK constant', () => {
    expect(RecoveryIssueCode.STALE_LOCK).toBe('STALE_LOCK');
  });

  it('exports LEFTOVER_WORKTREE constant', () => {
    expect(RecoveryIssueCode.LEFTOVER_WORKTREE).toBe('LEFTOVER_WORKTREE');
  });

  it('contains all RECOVERY_ISSUE_CODE_VALUES', () => {
    const enumValues = Object.values(RecoveryIssueCode);
    for (const value of RECOVERY_ISSUE_CODE_VALUES) {
      expect(enumValues).toContain(value);
    }
  });
});

describe('RecoveryActionType enum', () => {
  it('exports RESUME constant', () => {
    expect(RecoveryActionType.RESUME).toBe('resume');
  });

  it('exports RESET constant', () => {
    expect(RecoveryActionType.RESET).toBe('reset');
  });

  it('exports NUKE constant', () => {
    expect(RecoveryActionType.NUKE).toBe('nuke');
  });

  it('exports CLEANUP constant', () => {
    expect(RecoveryActionType.CLEANUP).toBe('cleanup');
  });

  it('contains all RECOVERY_ACTION_TYPE_VALUES', () => {
    const enumValues = Object.values(RecoveryActionType);
    for (const value of RECOVERY_ACTION_TYPE_VALUES) {
      expect(enumValues).toContain(value);
    }
  });
});
