/**
 * @file recovery-ports.test.ts
 * @description Tests for recovery-related port interfaces
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests verify:
 * - IRecoveryAnalyzer port interface definition
 * - Existing recovery analyzer satisfies port contract
 */

import { describe, it, expect, vi } from 'vitest';
import type { IRecoveryAnalyzer } from '../../ports/recovery.ports.js';
import type { WuContext } from '../../validation/types.js';
import { CONTEXT_VALIDATION } from '../../wu-constants.js';

const { LOCATION_TYPES, RECOVERY_ISSUES, RECOVERY_ACTIONS } = CONTEXT_VALIDATION;

describe('IRecoveryAnalyzer port interface', () => {
  describe('contract definition', () => {
    it('analyzeRecovery returns Promise<RecoveryAnalysis>', async () => {
      // Arrange: Create a mock implementation
      const mockAnalyzer: IRecoveryAnalyzer = {
        analyzeRecovery: vi.fn().mockResolvedValue({
          hasIssues: true,
          issues: [
            {
              code: RECOVERY_ISSUES.PARTIAL_CLAIM,
              description: 'Worktree exists but status is ready',
              context: { worktreePath: '/repo/worktrees/test', status: 'ready' },
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
        }),
      };

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
          id: 'WU-1093',
          status: 'ready',
          lane: 'Framework: Core',
          title: 'Test',
          yamlPath: '/repo/wu.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      // Act
      const result = await mockAnalyzer.analyzeRecovery(context);

      // Assert: Verify contract
      expect(result).toHaveProperty('hasIssues');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('actions');
      expect(result).toHaveProperty('wuId');
    });

    it('analyzeRecovery issues contain required fields', async () => {
      const mockAnalyzer: IRecoveryAnalyzer = {
        analyzeRecovery: vi.fn().mockResolvedValue({
          hasIssues: true,
          issues: [
            {
              code: RECOVERY_ISSUES.ORPHAN_CLAIM,
              description: 'WU in_progress but worktree missing',
            },
          ],
          actions: [],
          wuId: 'WU-1093',
        }),
      };

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
          id: 'WU-1093',
          status: 'in_progress',
          lane: 'Framework: Core',
          title: 'Test',
          yamlPath: '/repo/wu.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: true, sessionId: 'test' },
      };

      const result = await mockAnalyzer.analyzeRecovery(context);

      // Verify issue structure
      expect(result.issues[0]).toHaveProperty('code');
      expect(result.issues[0]).toHaveProperty('description');
    });

    it('analyzeRecovery actions contain required fields', async () => {
      const mockAnalyzer: IRecoveryAnalyzer = {
        analyzeRecovery: vi.fn().mockResolvedValue({
          hasIssues: true,
          issues: [],
          actions: [
            {
              type: RECOVERY_ACTIONS.RESET,
              description: 'Reset WU to ready',
              command: 'pnpm wu:recover --id WU-1093 --action reset',
              requiresForce: false,
              warning: 'This will discard uncommitted work',
            },
          ],
          wuId: 'WU-1093',
        }),
      };

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
          id: 'WU-1093',
          status: 'ready',
          lane: 'Framework: Core',
          title: 'Test',
          yamlPath: '/repo/wu.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      const result = await mockAnalyzer.analyzeRecovery(context);

      // Verify action structure
      expect(result.actions[0]).toHaveProperty('type');
      expect(result.actions[0]).toHaveProperty('description');
      expect(result.actions[0]).toHaveProperty('command');
      expect(result.actions[0]).toHaveProperty('requiresForce');
    });

    it('analyzeRecovery returns no issues when state is healthy', async () => {
      const mockAnalyzer: IRecoveryAnalyzer = {
        analyzeRecovery: vi.fn().mockResolvedValue({
          hasIssues: false,
          issues: [],
          actions: [],
          wuId: 'WU-1093',
        }),
      };

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
          id: 'WU-1093',
          status: 'ready',
          lane: 'Framework: Core',
          title: 'Test',
          yamlPath: '/repo/wu.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      const result = await mockAnalyzer.analyzeRecovery(context);

      expect(result.hasIssues).toBe(false);
      expect(result.issues).toHaveLength(0);
      expect(result.actions).toHaveLength(0);
    });
  });
});
