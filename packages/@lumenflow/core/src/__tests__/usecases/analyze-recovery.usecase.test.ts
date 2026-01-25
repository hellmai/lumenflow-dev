/**
 * AnalyzeRecoveryUseCase Tests
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Tests for AnalyzeRecoveryUseCase which analyzes WU state
 * for recovery actions using injected recovery analyzer.
 *
 * TDD: These tests are written BEFORE implementation.
 *
 * @module __tests__/usecases/analyze-recovery.usecase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import use case (will be created after tests fail)
import { AnalyzeRecoveryUseCase } from '../../usecases/analyze-recovery.usecase.js';

// Import port interfaces
import type { IRecoveryAnalyzer, WuContext, RecoveryAnalysis } from '../../ports/recovery.ports.js';

describe('AnalyzeRecoveryUseCase', () => {
  // Mock recovery analyzer
  let mockRecoveryAnalyzer: IRecoveryAnalyzer;

  // Mock context
  const mockContext: WuContext = {
    location: {
      type: 'main',
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
      tracking: 'origin/main',
      modifiedFiles: [],
      hasError: false,
      errorMessage: null,
    },
    wu: {
      id: 'WU-1094',
      status: 'ready',
      lane: 'Framework: Core',
      title: 'Test WU',
      yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1094.yaml',
      isConsistent: true,
      inconsistencyReason: null,
    },
    session: {
      isActive: false,
      sessionId: null,
    },
  };

  // Mock recovery analysis
  const mockRecoveryAnalysis: RecoveryAnalysis = {
    hasIssues: true,
    issues: [
      {
        code: 'PARTIAL_CLAIM',
        description: "Worktree exists for WU-1094 but status is 'ready'.",
        context: { worktreePath: '/repo/worktrees/framework-core-wu-1094' },
      },
    ],
    actions: [
      {
        type: 'resume',
        description: 'Reconcile state and continue working',
        command: 'pnpm wu:recover --id WU-1094 --action resume',
        requiresForce: false,
      },
    ],
    wuId: 'WU-1094',
  };

  beforeEach(() => {
    mockRecoveryAnalyzer = {
      analyzeRecovery: vi.fn().mockResolvedValue(mockRecoveryAnalysis),
    };
  });

  describe('constructor injection', () => {
    it('should accept recovery analyzer via constructor', () => {
      const useCase = new AnalyzeRecoveryUseCase(mockRecoveryAnalyzer);

      expect(useCase).toBeDefined();
    });
  });

  describe('execute()', () => {
    it('should delegate to recovery analyzer', async () => {
      const useCase = new AnalyzeRecoveryUseCase(mockRecoveryAnalyzer);

      const result = await useCase.execute(mockContext);

      expect(mockRecoveryAnalyzer.analyzeRecovery).toHaveBeenCalledWith(mockContext);
    });

    it('should return RecoveryAnalysis', async () => {
      const useCase = new AnalyzeRecoveryUseCase(mockRecoveryAnalyzer);

      const result = await useCase.execute(mockContext);

      expect(result).toHaveProperty('hasIssues');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('actions');
      expect(result).toHaveProperty('wuId');
    });

    it('should return issues when detected', async () => {
      const useCase = new AnalyzeRecoveryUseCase(mockRecoveryAnalyzer);

      const result = await useCase.execute(mockContext);

      expect(result.hasIssues).toBe(true);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].code).toBe('PARTIAL_CLAIM');
    });

    it('should return suggested actions', async () => {
      const useCase = new AnalyzeRecoveryUseCase(mockRecoveryAnalyzer);

      const result = await useCase.execute(mockContext);

      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.actions[0].type).toBe('resume');
      expect(result.actions[0].command).toContain('wu:recover');
    });

    it('should return no issues when context is clean', async () => {
      const cleanAnalysis: RecoveryAnalysis = {
        hasIssues: false,
        issues: [],
        actions: [],
        wuId: 'WU-1094',
      };
      mockRecoveryAnalyzer.analyzeRecovery = vi.fn().mockResolvedValue(cleanAnalysis);

      const useCase = new AnalyzeRecoveryUseCase(mockRecoveryAnalyzer);

      const result = await useCase.execute(mockContext);

      expect(result.hasIssues).toBe(false);
      expect(result.issues).toHaveLength(0);
      expect(result.actions).toHaveLength(0);
    });

    it('should return null wuId when no WU in context', async () => {
      const noWuAnalysis: RecoveryAnalysis = {
        hasIssues: false,
        issues: [],
        actions: [],
        wuId: null,
      };
      mockRecoveryAnalyzer.analyzeRecovery = vi.fn().mockResolvedValue(noWuAnalysis);

      const noWuContext: WuContext = {
        ...mockContext,
        wu: null,
      };

      const useCase = new AnalyzeRecoveryUseCase(mockRecoveryAnalyzer);

      const result = await useCase.execute(noWuContext);

      expect(result.wuId).toBeNull();
    });
  });
});
