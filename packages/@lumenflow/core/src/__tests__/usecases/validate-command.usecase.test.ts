/**
 * ValidateCommandUseCase Tests
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Tests for ValidateCommandUseCase which validates commands
 * using injected command registry.
 *
 * TDD: These tests are written BEFORE implementation.
 *
 * @module __tests__/usecases/validate-command.usecase
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import use case (will be created after tests fail)
import { ValidateCommandUseCase } from '../../usecases/validate-command.usecase.js';

// Import port interfaces
import type {
  ICommandRegistry,
  CommandDefinition,
  WuContext,
} from '../../ports/validation.ports.js';
import type { LocationContext, GitState } from '../../ports/context.ports.js';

describe('ValidateCommandUseCase', () => {
  // Mock command registry
  let mockCommandRegistry: ICommandRegistry;

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
      status: 'in_progress',
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

  // Mock command definition
  const mockCommandDef: CommandDefinition = {
    name: 'wu:done',
    description: 'Complete WU (merge, stamp, cleanup)',
    requiredLocation: 'main',
    requiredWuStatus: 'in_progress',
    predicates: [],
    getNextSteps: () => ['WU completed successfully!'],
  };

  beforeEach(() => {
    mockCommandRegistry = {
      getCommandDefinition: vi.fn().mockReturnValue(mockCommandDef),
      getValidCommandsForContext: vi.fn().mockReturnValue([mockCommandDef]),
      getAllCommands: vi.fn().mockReturnValue([mockCommandDef]),
    };
  });

  describe('constructor injection', () => {
    it('should accept command registry via constructor', () => {
      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      expect(useCase).toBeDefined();
    });
  });

  describe('execute()', () => {
    it('should validate command against context', async () => {
      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      const result = await useCase.execute('wu:done', mockContext);

      expect(mockCommandRegistry.getCommandDefinition).toHaveBeenCalledWith('wu:done');
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('context');
    });

    it('should return valid=true for matching context', async () => {
      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      const result = await useCase.execute('wu:done', mockContext);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return valid=false for unknown command', async () => {
      mockCommandRegistry.getCommandDefinition = vi.fn().mockReturnValue(null);

      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      const result = await useCase.execute('wu:unknown', mockContext);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
      // Unknown commands are not in the registry, so this is a special case
      // The error message should indicate the command wasn't found
      expect(result.errors[0].message).toContain('wu:unknown');
    });

    it('should return error for wrong location', async () => {
      const worktreeContext: WuContext = {
        ...mockContext,
        location: {
          ...mockContext.location,
          type: 'worktree',
        },
      };

      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      const result = await useCase.execute('wu:done', worktreeContext);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'WRONG_LOCATION')).toBe(true);
    });

    it('should return error for wrong WU status', async () => {
      const readyWuContext: WuContext = {
        ...mockContext,
        wu: {
          ...mockContext.wu!,
          status: 'ready',
        },
      };

      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      const result = await useCase.execute('wu:done', readyWuContext);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.code === 'WRONG_WU_STATUS')).toBe(true);
    });

    it('should provide fix command for errors', async () => {
      const worktreeContext: WuContext = {
        ...mockContext,
        location: {
          ...mockContext.location,
          type: 'worktree',
          cwd: '/repo/worktrees/framework-core-wu-1094',
        },
      };

      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      const result = await useCase.execute('wu:done', worktreeContext);

      expect(result.valid).toBe(false);
      const locationError = result.errors.find((e) => e.code === 'WRONG_LOCATION');
      expect(locationError?.fixCommand).toContain('cd');
      expect(locationError?.fixCommand).toContain('/repo');
    });

    it('should include context in result for debugging', async () => {
      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      const result = await useCase.execute('wu:done', mockContext);

      expect(result.context).toBe(mockContext);
    });
  });

  describe('getValidCommands()', () => {
    it('should return valid commands for context', async () => {
      const useCase = new ValidateCommandUseCase(mockCommandRegistry);

      const result = await useCase.getValidCommands(mockContext);

      expect(mockCommandRegistry.getValidCommandsForContext).toHaveBeenCalledWith(mockContext);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
