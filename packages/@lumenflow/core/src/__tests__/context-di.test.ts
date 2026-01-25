/**
 * Context DI Tests
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Tests for dependency injection factory functions in context-di.ts.
 * The DI file becomes the composition root where concrete implementations
 * are wired to abstractions.
 *
 * TDD: These tests are written BEFORE implementation.
 *
 * @module __tests__/context-di
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Import DI factory functions (will be created after tests fail)
import {
  createContextAdapters,
  createValidationAdapters,
  createRecoveryAdapters,
  createComputeContextUseCase,
  createValidateCommandUseCase,
  createAnalyzeRecoveryUseCase,
  // Legacy function names for backwards compatibility
  computeWuContext,
  validateCommand,
  analyzeRecoveryIssues,
} from '../context-di.js';

// Import use cases and adapters for type checking
import { ComputeContextUseCase } from '../usecases/compute-context.usecase.js';
import { ValidateCommandUseCase } from '../usecases/validate-command.usecase.js';
import { AnalyzeRecoveryUseCase } from '../usecases/analyze-recovery.usecase.js';

describe('Context DI Factory Functions', () => {
  describe('createContextAdapters()', () => {
    it('should return all context adapters', () => {
      const adapters = createContextAdapters();

      expect(adapters).toHaveProperty('locationResolver');
      expect(adapters).toHaveProperty('gitStateReader');
      expect(adapters).toHaveProperty('wuStateReader');
    });

    it('should return adapters implementing port interfaces', () => {
      const adapters = createContextAdapters();

      expect(typeof adapters.locationResolver.resolveLocation).toBe('function');
      expect(typeof adapters.gitStateReader.readGitState).toBe('function');
      expect(typeof adapters.wuStateReader.readWuState).toBe('function');
    });
  });

  describe('createValidationAdapters()', () => {
    it('should return command registry adapter', () => {
      const adapters = createValidationAdapters();

      expect(adapters).toHaveProperty('commandRegistry');
    });

    it('should return registry implementing ICommandRegistry', () => {
      const adapters = createValidationAdapters();

      expect(typeof adapters.commandRegistry.getCommandDefinition).toBe('function');
      expect(typeof adapters.commandRegistry.getValidCommandsForContext).toBe('function');
      expect(typeof adapters.commandRegistry.getAllCommands).toBe('function');
    });
  });

  describe('createRecoveryAdapters()', () => {
    it('should return recovery analyzer adapter', () => {
      const adapters = createRecoveryAdapters();

      expect(adapters).toHaveProperty('recoveryAnalyzer');
    });

    it('should return analyzer implementing IRecoveryAnalyzer', () => {
      const adapters = createRecoveryAdapters();

      expect(typeof adapters.recoveryAnalyzer.analyzeRecovery).toBe('function');
    });
  });

  describe('createComputeContextUseCase()', () => {
    it('should return ComputeContextUseCase instance', () => {
      const useCase = createComputeContextUseCase();

      expect(useCase).toBeInstanceOf(ComputeContextUseCase);
    });

    it('should allow custom adapters', () => {
      const mockLocationResolver = {
        resolveLocation: vi.fn(),
      };

      const useCase = createComputeContextUseCase({
        locationResolver: mockLocationResolver,
      });

      expect(useCase).toBeInstanceOf(ComputeContextUseCase);
    });
  });

  describe('createValidateCommandUseCase()', () => {
    it('should return ValidateCommandUseCase instance', () => {
      const useCase = createValidateCommandUseCase();

      expect(useCase).toBeInstanceOf(ValidateCommandUseCase);
    });

    it('should allow custom command registry', () => {
      const mockRegistry = {
        getCommandDefinition: vi.fn(),
        getValidCommandsForContext: vi.fn(),
        getAllCommands: vi.fn(),
      };

      const useCase = createValidateCommandUseCase({
        commandRegistry: mockRegistry,
      });

      expect(useCase).toBeInstanceOf(ValidateCommandUseCase);
    });
  });

  describe('createAnalyzeRecoveryUseCase()', () => {
    it('should return AnalyzeRecoveryUseCase instance', () => {
      const useCase = createAnalyzeRecoveryUseCase();

      expect(useCase).toBeInstanceOf(AnalyzeRecoveryUseCase);
    });

    it('should allow custom recovery analyzer', () => {
      const mockAnalyzer = {
        analyzeRecovery: vi.fn(),
      };

      const useCase = createAnalyzeRecoveryUseCase({
        recoveryAnalyzer: mockAnalyzer,
      });

      expect(useCase).toBeInstanceOf(AnalyzeRecoveryUseCase);
    });
  });
});

describe('Backwards Compatibility', () => {
  describe('computeWuContext()', () => {
    it('should be exported for backwards compatibility', () => {
      expect(typeof computeWuContext).toBe('function');
    });

    it('should return WuContext', async () => {
      const result = await computeWuContext({});

      expect(result).toHaveProperty('location');
      expect(result).toHaveProperty('git');
      expect(result).toHaveProperty('wu');
      expect(result).toHaveProperty('session');
    });

    it('should accept options like wuId and cwd', async () => {
      // Should not throw
      const result = await computeWuContext({ wuId: 'WU-1094' });
      expect(result).toBeDefined();
    });
  });

  describe('validateCommand()', () => {
    it('should be exported for backwards compatibility', () => {
      expect(typeof validateCommand).toBe('function');
    });

    it('should return ValidationResult', async () => {
      const context = await computeWuContext({});
      const result = await validateCommand('wu:status', context);

      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('context');
    });
  });

  describe('analyzeRecoveryIssues()', () => {
    it('should be exported for backwards compatibility', () => {
      expect(typeof analyzeRecoveryIssues).toBe('function');
    });

    it('should return RecoveryAnalysis', async () => {
      const context = await computeWuContext({});
      const result = await analyzeRecoveryIssues(context);

      expect(result).toHaveProperty('hasIssues');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('actions');
      expect(result).toHaveProperty('wuId');
    });
  });
});

describe('External User Custom Adapters', () => {
  it('should allow external users to instantiate use cases with custom adapters', async () => {
    // Scenario: External user wants to use mock adapters for testing
    const mockLocationContext = {
      type: 'main' as const,
      cwd: '/test',
      gitRoot: '/test',
      mainCheckout: '/test',
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

    const customLocationResolver = {
      resolveLocation: vi.fn().mockResolvedValue(mockLocationContext),
    };

    const customGitStateReader = {
      readGitState: vi.fn().mockResolvedValue(mockGitState),
    };

    const customWuStateReader = {
      readWuState: vi.fn().mockResolvedValue(null),
    };

    const useCase = createComputeContextUseCase({
      locationResolver: customLocationResolver,
      gitStateReader: customGitStateReader,
      wuStateReader: customWuStateReader,
    });

    const result = await useCase.execute({});

    expect(customLocationResolver.resolveLocation).toHaveBeenCalled();
    expect(customGitStateReader.readGitState).toHaveBeenCalled();
    expect(result.location).toEqual(mockLocationContext);
    expect(result.git).toEqual(mockGitState);
  });

  it('should allow mixing default and custom adapters', async () => {
    // User only wants to override location resolver
    const customLocationResolver = {
      resolveLocation: vi.fn().mockResolvedValue({
        type: 'main' as const,
        cwd: '/custom',
        gitRoot: '/custom',
        mainCheckout: '/custom',
        worktreeName: null,
        worktreeWuId: null,
      }),
    };

    const useCase = createComputeContextUseCase({
      locationResolver: customLocationResolver,
      // gitStateReader and wuStateReader use defaults
    });

    const result = await useCase.execute({});

    expect(customLocationResolver.resolveLocation).toHaveBeenCalled();
    expect(result.location.cwd).toBe('/custom');
  });
});
