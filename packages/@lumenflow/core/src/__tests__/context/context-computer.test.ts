/**
 * @file context-computer.test.ts
 * @description Tests for context computer (unified context computation)
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * TDD: RED phase - Tests written FIRST before implementation.
 *
 * Tests cover:
 * - Computing context with all modules
 * - Performance budget tracking
 * - WU ID resolution from options and worktree
 * - Session state building
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
vi.mock('../../context/location-resolver.js', () => ({
  resolveLocation: vi.fn(),
}));

vi.mock('../../context/git-state-reader.js', () => ({
  readGitState: vi.fn(),
}));

vi.mock('../../context/wu-state-reader.js', () => ({
  readWuState: vi.fn(),
}));

import { computeContext, type ComputeContextResult } from '../../context/context-computer.js';
import { resolveLocation } from '../../context/location-resolver.js';
import { readGitState } from '../../context/git-state-reader.js';
import { readWuState } from '../../context/wu-state-reader.js';
import { CONTEXT_VALIDATION } from '../../wu-constants.js';

const { LOCATION_TYPES, THRESHOLDS } = CONTEXT_VALIDATION;

describe('computeContext', () => {
  const mockLocation = {
    type: LOCATION_TYPES.MAIN,
    cwd: '/repo',
    gitRoot: '/repo',
    mainCheckout: '/repo',
    worktreeName: null,
    worktreeWuId: null,
  };

  const mockGitState = {
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
  };

  const mockWuState = {
    id: 'WU-1090',
    status: 'in_progress',
    lane: 'Framework: Core',
    title: 'Test WU',
    yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1090.yaml',
    isConsistent: true,
    inconsistencyReason: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveLocation).mockResolvedValue(mockLocation);
    vi.mocked(readGitState).mockResolvedValue(mockGitState);
    vi.mocked(readWuState).mockResolvedValue(mockWuState);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('basic functionality', () => {
    it('computes context with all modules', async () => {
      // Act
      const result = await computeContext({ wuId: 'WU-1090' });

      // Assert
      expect(result.context.location).toEqual(mockLocation);
      expect(result.context.git).toEqual(mockGitState);
      expect(result.context.wu).toEqual(mockWuState);
    });

    it('returns null wu when no WU ID provided and not in worktree', async () => {
      // Act
      const result = await computeContext();

      // Assert
      expect(result.context.wu).toBeNull();
      expect(readWuState).not.toHaveBeenCalled();
    });

    it('resolves WU ID from worktree when in worktree', async () => {
      // Arrange
      const worktreeLocation = {
        ...mockLocation,
        type: LOCATION_TYPES.WORKTREE,
        worktreeName: 'framework-core-wu-1090',
        worktreeWuId: 'WU-1090',
      };
      vi.mocked(resolveLocation).mockResolvedValue(worktreeLocation);

      // Act
      const result = await computeContext();

      // Assert
      expect(readWuState).toHaveBeenCalledWith('WU-1090', '/repo');
      expect(result.context.wu).toEqual(mockWuState);
    });

    it('prefers explicit wuId over worktree WU ID', async () => {
      // Arrange
      const worktreeLocation = {
        ...mockLocation,
        type: LOCATION_TYPES.WORKTREE,
        worktreeName: 'framework-core-wu-1090',
        worktreeWuId: 'WU-1090',
      };
      vi.mocked(resolveLocation).mockResolvedValue(worktreeLocation);

      // Act
      await computeContext({ wuId: 'WU-2000' });

      // Assert - should use explicit WU ID, not worktree ID
      expect(readWuState).toHaveBeenCalledWith('WU-2000', '/repo');
    });
  });

  describe('session state', () => {
    it('builds session state with sessionId when provided', async () => {
      // Act
      const result = await computeContext({ sessionId: 'session-123' });

      // Assert
      expect(result.context.session).toEqual({
        isActive: true,
        sessionId: 'session-123',
      });
    });

    it('builds inactive session state when no sessionId', async () => {
      // Act
      const result = await computeContext();

      // Assert
      expect(result.context.session).toEqual({
        isActive: false,
        sessionId: null,
      });
    });
  });

  describe('performance tracking', () => {
    it('returns computation time in milliseconds', async () => {
      // Act
      const result = await computeContext();

      // Assert
      expect(typeof result.computationMs).toBe('number');
      expect(result.computationMs).toBeGreaterThanOrEqual(0);
    });

    it('tracks when budget is exceeded', async () => {
      // Arrange - make location resolution slow
      vi.mocked(resolveLocation).mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, THRESHOLDS.CONTEXT_COMPUTATION_MS + 50));
        return mockLocation;
      });

      // Act
      const result = await computeContext();

      // Assert
      expect(result.exceededBudget).toBe(true);
      expect(result.computationMs).toBeGreaterThan(THRESHOLDS.CONTEXT_COMPUTATION_MS);
    });

    it('returns exceededBudget=false when within budget', async () => {
      // Act
      const result = await computeContext();

      // Assert
      expect(result.exceededBudget).toBe(false);
    });
  });

  describe('WU state handling', () => {
    it('returns null wu when WU not found', async () => {
      // Arrange
      vi.mocked(readWuState).mockResolvedValue(null);

      // Act
      const result = await computeContext({ wuId: 'WU-9999' });

      // Assert
      expect(result.context.wu).toBeNull();
    });

    it('handles WU state with inconsistency', async () => {
      // Arrange
      const inconsistentState = {
        ...mockWuState,
        isConsistent: false,
        inconsistencyReason: 'YAML says ready but state store says in_progress',
      };
      vi.mocked(readWuState).mockResolvedValue(inconsistentState);

      // Act
      const result = await computeContext({ wuId: 'WU-1090' });

      // Assert
      expect(result.context.wu?.isConsistent).toBe(false);
      expect(result.context.wu?.inconsistencyReason).toContain('YAML says ready');
    });
  });

  /**
   * WU-1092: Tests for worktreeGit field population.
   *
   * When running wu:done from main checkout, we need to check the worktree's
   * git state, not main's git state. These tests verify that worktreeGit is
   * computed when applicable.
   */
  describe('worktreeGit population (WU-1092)', () => {
    it('populates worktreeGit when running from main with in_progress WU that has worktree', async () => {
      // Arrange: Running from main, WU is in_progress (implying worktree exists)
      const mainLocation = {
        type: LOCATION_TYPES.MAIN,
        cwd: '/repo',
        gitRoot: '/repo',
        mainCheckout: '/repo',
        worktreeName: null,
        worktreeWuId: null,
      };
      vi.mocked(resolveLocation).mockResolvedValue(mainLocation);

      // WU is in_progress with a lane
      const inProgressWu = {
        ...mockWuState,
        status: 'in_progress',
        lane: 'Framework: Core',
      };
      vi.mocked(readWuState).mockResolvedValue(inProgressWu);

      // Main is clean, but worktree is dirty
      const mainGitState = { ...mockGitState, isDirty: false };
      const worktreeGitState = { ...mockGitState, isDirty: true, modifiedFiles: ['src/file.ts'] };

      // readGitState is called twice: once for cwd (main), once for worktree
      vi.mocked(readGitState)
        .mockResolvedValueOnce(mainGitState) // First call: main checkout
        .mockResolvedValueOnce(worktreeGitState); // Second call: worktree

      // Act
      const result = await computeContext({ wuId: 'WU-1090' });

      // Assert
      expect(result.context.git).toEqual(mainGitState);
      expect(result.context.worktreeGit).toBeDefined();
      expect(result.context.worktreeGit?.isDirty).toBe(true);
      expect(result.context.worktreeGit?.modifiedFiles).toContain('src/file.ts');
    });

    it('does NOT populate worktreeGit when running from worktree', async () => {
      // Arrange: Running from worktree
      const worktreeLocation = {
        type: LOCATION_TYPES.WORKTREE,
        cwd: '/repo/worktrees/framework-core-wu-1090',
        gitRoot: '/repo/worktrees/framework-core-wu-1090',
        mainCheckout: '/repo',
        worktreeName: 'framework-core-wu-1090',
        worktreeWuId: 'WU-1090',
      };
      vi.mocked(resolveLocation).mockResolvedValue(worktreeLocation);

      // Act
      const result = await computeContext();

      // Assert: worktreeGit should not be populated when already in worktree
      expect(result.context.worktreeGit).toBeUndefined();
    });

    it('does NOT populate worktreeGit when WU is not in_progress', async () => {
      // Arrange: WU is ready (no worktree exists yet)
      const readyWu = {
        ...mockWuState,
        status: 'ready',
      };
      vi.mocked(readWuState).mockResolvedValue(readyWu);

      // Act
      const result = await computeContext({ wuId: 'WU-1090' });

      // Assert: worktreeGit should not be populated for non-active WUs
      expect(result.context.worktreeGit).toBeUndefined();
    });

    it('does NOT populate worktreeGit when no WU specified', async () => {
      // Act
      const result = await computeContext();

      // Assert
      expect(result.context.worktreeGit).toBeUndefined();
    });

    it('handles worktree path not existing gracefully', async () => {
      // Arrange: WU is in_progress but worktree path doesn't exist
      const inProgressWu = {
        ...mockWuState,
        status: 'in_progress',
        lane: 'Framework: Core',
      };
      vi.mocked(readWuState).mockResolvedValue(inProgressWu);

      // readGitState throws for worktree (path doesn't exist)
      vi.mocked(readGitState)
        .mockResolvedValueOnce(mockGitState) // Main checkout
        .mockResolvedValueOnce({
          // Worktree - returns error state
          ...mockGitState,
          hasError: true,
          errorMessage: 'Not a git repository',
        });

      // Act
      const result = await computeContext({ wuId: 'WU-1090' });

      // Assert: worktreeGit should show error state, not throw
      expect(result.context.worktreeGit?.hasError).toBe(true);
    });
  });
});
