/**
 * @file validate-command.test.ts
 * @description Tests for command validation with copy-paste fix guidance
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests cover:
 * - Location validation with fix commands
 * - WU status validation with guidance
 * - Predicate validation with severity levels
 * - Copy-paste ready fix commands
 */

import { describe, it, expect } from 'vitest';
import { validateCommand } from '../../validation/validate-command.js';
import { CONTEXT_VALIDATION, WU_STATUS } from '../../wu-constants.js';
import type { WuContext } from '../../validation/types.js';

const { LOCATION_TYPES, COMMANDS, ERROR_CODES } = CONTEXT_VALIDATION;

describe('validateCommand', () => {
  describe('location validation', () => {
    it('returns valid when location requirement is satisfied', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      };

      const result = validateCommand(COMMANDS.WU_CREATE, context);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns error with fix command when wrong location', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.WORKTREE,
          cwd: '/repo/worktrees/framework-core-wu-1090',
          gitRoot: '/repo/worktrees/framework-core-wu-1090',
          mainCheckout: '/repo',
          worktreeName: 'framework-core-wu-1090',
          worktreeWuId: 'WU-1090',
        },
        git: {
          branch: 'lane/framework-core/wu-1090',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: {
          id: 'WU-1090',
          status: WU_STATUS.IN_PROGRESS,
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: true, sessionId: 'sess-123' },
      };

      const result = validateCommand(COMMANDS.WU_DONE, context);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);

      const locationError = result.errors.find(
        (e) => e.code === ERROR_CODES.WRONG_LOCATION,
      );
      expect(locationError).toBeDefined();
      // Should provide copy-paste fix command with actual path
      expect(locationError?.fixCommand).toContain('cd /repo');
    });

    it('provides actual mainCheckout path in fix command', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.WORKTREE,
          cwd: '/home/user/project/worktrees/operations-wu-42',
          gitRoot: '/home/user/project/worktrees/operations-wu-42',
          mainCheckout: '/home/user/project',
          worktreeName: 'operations-wu-42',
          worktreeWuId: 'WU-42',
        },
        git: {
          branch: 'lane/operations/wu-42',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      };

      const result = validateCommand(COMMANDS.WU_CREATE, context);

      expect(result.valid).toBe(false);
      const locationError = result.errors.find(
        (e) => e.code === ERROR_CODES.WRONG_LOCATION,
      );
      expect(locationError?.fixCommand).toContain('cd /home/user/project');
    });
  });

  describe('WU status validation', () => {
    it('returns valid when WU status requirement is satisfied', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: {
          id: 'WU-1090',
          status: WU_STATUS.READY,
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      const result = validateCommand(COMMANDS.WU_CLAIM, context);

      expect(result.valid).toBe(true);
    });

    it('returns error when WU status does not match requirement', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: {
          id: 'WU-1090',
          status: WU_STATUS.IN_PROGRESS,
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: true, sessionId: 'sess-123' },
      };

      const result = validateCommand(COMMANDS.WU_CLAIM, context);

      expect(result.valid).toBe(false);
      const statusError = result.errors.find(
        (e) => e.code === ERROR_CODES.WRONG_WU_STATUS,
      );
      expect(statusError).toBeDefined();
      expect(statusError?.message).toContain('ready');
      expect(statusError?.message).toContain('in_progress');
    });

    it('returns error when WU is required but not provided', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null, // No WU specified
        session: { isActive: false, sessionId: null },
      };

      const result = validateCommand(COMMANDS.WU_CLAIM, context);

      expect(result.valid).toBe(false);
      const notFoundError = result.errors.find(
        (e) => e.code === ERROR_CODES.WU_NOT_FOUND,
      );
      expect(notFoundError).toBeDefined();
    });
  });

  describe('predicate validation', () => {
    it('returns warning for warning-severity predicate failure', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0, // No commits ahead - warning predicate
          behind: 0,
          tracking: 'origin/main',
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: {
          id: 'WU-1090',
          status: WU_STATUS.IN_PROGRESS,
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: true, sessionId: 'sess-123' },
      };

      const result = validateCommand(COMMANDS.WU_DONE, context);

      // Should still be valid (warnings don't block)
      // Note: Other predicates may cause errors, so check warnings exist
      expect(result.warnings.length).toBeGreaterThan(0);
      const hasCommitsWarning = result.warnings.find(
        (w) => w.id === 'has-commits',
      );
      expect(hasCommitsWarning).toBeDefined();
    });

    it('returns error for error-severity predicate failure', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: true, // Dirty - error predicate
          hasStaged: false,
          ahead: 1,
          behind: 0,
          tracking: 'origin/main',
          modifiedFiles: ['file.ts'],
          hasError: false,
          errorMessage: null,
        },
        wu: {
          id: 'WU-1090',
          status: WU_STATUS.IN_PROGRESS,
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: true, sessionId: 'sess-123' },
      };

      const result = validateCommand(COMMANDS.WU_DONE, context);

      expect(result.valid).toBe(false);
      const dirtyError = result.errors.find(
        (e) => e.message.includes('uncommitted'),
      );
      expect(dirtyError).toBeDefined();
    });
  });

  describe('unknown command handling', () => {
    it('returns error for unknown command', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      };

      const result = validateCommand('wu:unknown' as never, context);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('result context', () => {
    it('includes context in result for debugging', () => {
      const context: WuContext = {
        location: {
          type: LOCATION_TYPES.MAIN,
          cwd: '/repo',
          gitRoot: '/repo',
          mainCheckout: '/repo',
          worktreeName: null,
          worktreeWuId: null,
        },
        git: {
          branch: 'main',
          isDetached: false,
          isDirty: false,
          hasStaged: false,
          ahead: 0,
          behind: 0,
          tracking: null,
          modifiedFiles: [],
          hasError: false,
          errorMessage: null,
        },
        wu: null,
        session: { isActive: false, sessionId: null },
      };

      const result = validateCommand(COMMANDS.WU_CREATE, context);

      expect(result.context).toBe(context);
    });
  });
});
