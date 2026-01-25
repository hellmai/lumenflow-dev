/**
 * ComputeContextUseCase Tests
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Tests for ComputeContextUseCase which orchestrates context computation
 * using injected adapters.
 *
 * TDD: These tests are written BEFORE implementation.
 *
 * @module __tests__/usecases/compute-context.usecase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import use case (will be created after tests fail)
import { ComputeContextUseCase } from '../../usecases/compute-context.usecase.js';

// Import port interfaces
import type {
  ILocationResolver,
  IGitStateReader,
  IWuStateReader,
  LocationContext,
  GitState,
  WuStateResult,
} from '../../ports/context.ports.js';

describe('ComputeContextUseCase', () => {
  // Mock adapters
  let mockLocationResolver: ILocationResolver;
  let mockGitStateReader: IGitStateReader;
  let mockWuStateReader: IWuStateReader;

  // Mock data
  const mockLocationContext: LocationContext = {
    type: 'main',
    cwd: '/repo',
    gitRoot: '/repo',
    mainCheckout: '/repo',
    worktreeName: null,
    worktreeWuId: null,
  };

  const mockGitState: GitState = {
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

  const mockWuStateResult: WuStateResult = {
    id: 'WU-1094',
    status: 'in_progress',
    lane: 'Framework: Core',
    title: 'Test WU',
    yamlPath: '/repo/docs/04-operations/tasks/wu/WU-1094.yaml',
    isConsistent: true,
    inconsistencyReason: null,
  };

  beforeEach(() => {
    mockLocationResolver = {
      resolveLocation: vi.fn().mockResolvedValue(mockLocationContext),
    };

    mockGitStateReader = {
      readGitState: vi.fn().mockResolvedValue(mockGitState),
    };

    mockWuStateReader = {
      readWuState: vi.fn().mockResolvedValue(mockWuStateResult),
    };
  });

  describe('constructor injection', () => {
    it('should accept adapters via constructor', () => {
      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      expect(useCase).toBeDefined();
    });
  });

  describe('execute()', () => {
    it('should call all adapters to compute context', async () => {
      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      const result = await useCase.execute({ wuId: 'WU-1094' });

      expect(mockLocationResolver.resolveLocation).toHaveBeenCalled();
      expect(mockGitStateReader.readGitState).toHaveBeenCalled();
    });

    it('should return WuContext with location, git, wu, and session', async () => {
      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      const result = await useCase.execute({ wuId: 'WU-1094' });

      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('git');
      expect(result).toHaveProperty('wu');
      expect(result).toHaveProperty('session');
    });

    it('should use custom cwd if provided', async () => {
      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      const customCwd = '/custom/path';
      await useCase.execute({ wuId: 'WU-1094', cwd: customCwd });

      expect(mockLocationResolver.resolveLocation).toHaveBeenCalledWith(customCwd);
      expect(mockGitStateReader.readGitState).toHaveBeenCalledWith(customCwd);
    });

    it('should handle null WU state when wuId not provided', async () => {
      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      const result = await useCase.execute({});

      expect(result.wu).toBeNull();
      expect(mockWuStateReader.readWuState).not.toHaveBeenCalled();
    });

    it('should read WU state when wuId is provided', async () => {
      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      await useCase.execute({ wuId: 'WU-1094' });

      expect(mockWuStateReader.readWuState).toHaveBeenCalledWith(
        'WU-1094',
        mockLocationContext.mainCheckout,
      );
    });

    it('should detect WU from worktree when in worktree and no wuId provided', async () => {
      const worktreeLocationContext: LocationContext = {
        type: 'worktree',
        cwd: '/repo/worktrees/framework-core-wu-1094',
        gitRoot: '/repo/worktrees/framework-core-wu-1094',
        mainCheckout: '/repo',
        worktreeName: 'framework-core-wu-1094',
        worktreeWuId: 'WU-1094',
      };

      mockLocationResolver.resolveLocation = vi.fn().mockResolvedValue(worktreeLocationContext);

      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      await useCase.execute({});

      // Should use worktreeWuId to read WU state
      expect(mockWuStateReader.readWuState).toHaveBeenCalledWith(
        'WU-1094',
        worktreeLocationContext.mainCheckout,
      );
    });

    it('should include worktreeGit when running from main with WU in_progress', async () => {
      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      // Mock WU with worktree_path
      const wuWithWorktree = {
        ...mockWuStateResult,
        worktree_path: '/repo/worktrees/framework-core-wu-1094',
      };
      mockWuStateReader.readWuState = vi.fn().mockResolvedValue(wuWithWorktree);

      const worktreeGitState: GitState = {
        ...mockGitState,
        isDirty: true,
      };
      mockGitStateReader.readGitState = vi
        .fn()
        .mockResolvedValueOnce(mockGitState) // main git state
        .mockResolvedValueOnce(worktreeGitState); // worktree git state

      const result = await useCase.execute({ wuId: 'WU-1094' });

      // worktreeGit should be populated when running from main
      expect(result.worktreeGit).toBeDefined();
    });
  });

  describe('session state', () => {
    it('should return inactive session by default', async () => {
      const useCase = new ComputeContextUseCase(
        mockLocationResolver,
        mockGitStateReader,
        mockWuStateReader,
      );

      const result = await useCase.execute({});

      expect(result.session).toEqual({
        isActive: false,
        sessionId: null,
      });
    });
  });
});
