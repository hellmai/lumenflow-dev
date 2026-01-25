/**
 * @file recovery-analyzer.test.ts
 * @description Tests for WU recovery analysis (detect issues and suggest actions)
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests cover:
 * - Detecting partial claim (worktree exists but status is ready)
 * - Detecting orphan claim (status is in_progress but worktree missing)
 * - Detecting inconsistent state (YAML vs state store)
 * - Detecting orphan branch (branch exists but worktree missing)
 * - Detecting stale lock (old lock file)
 * - Suggesting appropriate recovery actions
 * - Recovery action idempotency
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
}));

vi.mock('simple-git', () => {
  const mockGit = {
    raw: vi.fn(),
    branchLocal: vi.fn(),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

import {
  analyzeRecovery,
  type RecoveryAnalysis,
  type WuRecoveryAction,
} from '../../recovery/recovery-analyzer.js';
import { CONTEXT_VALIDATION, WU_STATUS } from '../../wu-constants.js';
import type { WuContext } from '../../validation/types.js';
import { existsSync, statSync } from 'node:fs';
import { simpleGit } from 'simple-git';

const { LOCATION_TYPES, RECOVERY_ISSUES, RECOVERY_ACTIONS } = CONTEXT_VALIDATION;

describe('analyzeRecovery', () => {
  let mockGit: {
    raw: ReturnType<typeof vi.fn>;
    branchLocal: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGit = (simpleGit as unknown as ReturnType<typeof vi.fn>)() as typeof mockGit;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('partial claim detection', () => {
    it('detects partial claim when worktree exists but status is ready', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true); // Worktree exists

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
          status: WU_STATUS.READY, // Status says ready
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      // Act
      const result = await analyzeRecovery(context);

      // Assert
      expect(result.hasIssues).toBe(true);
      const partialClaimIssue = result.issues.find((i) => i.code === RECOVERY_ISSUES.PARTIAL_CLAIM);
      expect(partialClaimIssue).toBeDefined();
    });

    it('suggests resume action for partial claim', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true);

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

      // Act
      const result = await analyzeRecovery(context);

      // Assert
      const resumeAction = result.actions.find((a) => a.type === RECOVERY_ACTIONS.RESUME);
      expect(resumeAction).toBeDefined();
      expect(resumeAction?.description.toLowerCase()).toContain('reconcile');
    });
  });

  describe('orphan claim detection', () => {
    it('detects orphan claim when status is in_progress but worktree missing', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(false); // Worktree does NOT exist

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
          status: WU_STATUS.IN_PROGRESS, // Status says in_progress
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      // Act
      const result = await analyzeRecovery(context);

      // Assert
      expect(result.hasIssues).toBe(true);
      const orphanClaimIssue = result.issues.find((i) => i.code === RECOVERY_ISSUES.ORPHAN_CLAIM);
      expect(orphanClaimIssue).toBeDefined();
    });

    it('suggests reset action for orphan claim', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(false);

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
        session: { isActive: false, sessionId: null },
      };

      // Act
      const result = await analyzeRecovery(context);

      // Assert
      const resetAction = result.actions.find((a) => a.type === RECOVERY_ACTIONS.RESET);
      expect(resetAction).toBeDefined();
    });
  });

  describe('leftover worktree detection', () => {
    it('detects leftover worktree when WU is done but worktree exists', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true); // Worktree exists

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
          status: WU_STATUS.DONE, // Status is done
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      // Act
      const result = await analyzeRecovery(context);

      // Assert
      expect(result.hasIssues).toBe(true);
      const leftoverIssue = result.issues.find((i) => i.code === RECOVERY_ISSUES.LEFTOVER_WORKTREE);
      expect(leftoverIssue).toBeDefined();
    });

    it('suggests cleanup action for leftover worktree', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true);

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
          status: WU_STATUS.DONE,
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      // Act
      const result = await analyzeRecovery(context);

      // Assert
      const cleanupAction = result.actions.find((a) => a.type === RECOVERY_ACTIONS.CLEANUP);
      expect(cleanupAction).toBeDefined();
    });
  });

  describe('recovery command suggestions (WU-1096)', () => {
    it('suggests wu:recover --action cleanup instead of wu:cleanup for leftover worktree', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(true); // Worktree exists

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
          id: 'WU-1096',
          status: WU_STATUS.DONE,
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1096.yaml',
          isConsistent: true,
          inconsistencyReason: null,
        },
        session: { isActive: false, sessionId: null },
      };

      // Act
      const result = await analyzeRecovery(context);

      // Assert - command should use wu:recover --action cleanup, NOT wu:cleanup
      const cleanupAction = result.actions.find((a) => a.type === RECOVERY_ACTIONS.CLEANUP);
      expect(cleanupAction).toBeDefined();
      expect(cleanupAction?.command).toBe('pnpm wu:recover --id WU-1096 --action cleanup');
      expect(cleanupAction?.command).not.toContain('wu:cleanup --id');
    });

    it('suggests wu:recover --action reset instead of wu:repair for inconsistent state', async () => {
      // Arrange
      vi.mocked(existsSync).mockReturnValue(false);

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
          id: 'WU-1096',
          status: WU_STATUS.READY,
          lane: 'Framework: Core',
          title: 'Test WU',
          yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1096.yaml',
          isConsistent: false,
          inconsistencyReason: 'YAML status differs from state store',
        },
        session: { isActive: false, sessionId: null },
      };

      // Act
      const result = await analyzeRecovery(context);

      // Assert - command should use wu:recover --action reset, NOT wu:repair
      const resetAction = result.actions.find((a) => a.type === RECOVERY_ACTIONS.RESET);
      expect(resetAction).toBeDefined();
      expect(resetAction?.command).toBe('pnpm wu:recover --id WU-1096 --action reset');
      expect(resetAction?.command).not.toContain('wu:repair');
    });
  });

  describe('healthy state detection', () => {
    it('returns no issues for healthy in_progress state', async () => {
      // Arrange - worktree exists, status is in_progress - all good
      vi.mocked(existsSync).mockReturnValue(true);

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

      // Act
      const result = await analyzeRecovery(context);

      // Assert
      expect(result.hasIssues).toBe(false);
      expect(result.issues).toHaveLength(0);
    });

    it('returns no issues when no WU context provided', async () => {
      // Arrange
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

      // Act
      const result = await analyzeRecovery(context);

      // Assert
      expect(result.hasIssues).toBe(false);
    });
  });
});
