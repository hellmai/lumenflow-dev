/**
 * Context Dependency Injection
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Composition root for wiring concrete adapter implementations to use cases.
 * This file provides factory functions for creating use cases with default
 * or custom adapters.
 *
 * Design Principles:
 * - Factory functions return fully wired use cases
 * - Custom adapters can be injected for testing
 * - Legacy function exports maintain backwards compatibility
 *
 * @module context-di
 */

// Import port interfaces
import type { ILocationResolver, IGitStateReader, IWuStateReader } from './ports/context.ports.js';
import type { ICommandRegistry } from './ports/validation.ports.js';
import type { IRecoveryAnalyzer, WuContext, RecoveryAnalysis } from './ports/recovery.ports.js';
import type { ValidationResult } from './validation/types.js';

// Import adapters
import {
  SimpleGitLocationAdapter,
  SimpleGitStateAdapter,
  FileSystemWuStateAdapter,
} from './adapters/context-adapters.js';
import { CommandRegistryAdapter } from './adapters/validation-adapters.js';
import { RecoveryAnalyzerAdapter } from './adapters/recovery-adapters.js';

// Import use cases
import {
  ComputeContextUseCase,
  type ComputeContextOptions,
} from './usecases/compute-context.usecase.js';
import { ValidateCommandUseCase } from './usecases/validate-command.usecase.js';
import { AnalyzeRecoveryUseCase } from './usecases/analyze-recovery.usecase.js';

// ============================================================================
// Adapter Factory Functions
// ============================================================================

/**
 * Context adapters bundle.
 */
export interface ContextAdapters {
  locationResolver: ILocationResolver;
  gitStateReader: IGitStateReader;
  wuStateReader: IWuStateReader;
}

/**
 * Create all context adapters with default implementations.
 *
 * @example
 * const adapters = createContextAdapters();
 * const location = await adapters.locationResolver.resolveLocation();
 */
export function createContextAdapters(): ContextAdapters {
  return {
    locationResolver: new SimpleGitLocationAdapter(),
    gitStateReader: new SimpleGitStateAdapter(),
    wuStateReader: new FileSystemWuStateAdapter(),
  };
}

/**
 * Validation adapters bundle.
 */
export interface ValidationAdapters {
  commandRegistry: ICommandRegistry;
}

/**
 * Create all validation adapters with default implementations.
 *
 * @example
 * const adapters = createValidationAdapters();
 * const def = adapters.commandRegistry.getCommandDefinition('wu:done');
 */
export function createValidationAdapters(): ValidationAdapters {
  return {
    commandRegistry: new CommandRegistryAdapter(),
  };
}

/**
 * Recovery adapters bundle.
 */
export interface RecoveryAdapters {
  recoveryAnalyzer: IRecoveryAnalyzer;
}

/**
 * Create all recovery adapters with default implementations.
 *
 * @example
 * const adapters = createRecoveryAdapters();
 * const analysis = await adapters.recoveryAnalyzer.analyzeRecovery(context);
 */
export function createRecoveryAdapters(): RecoveryAdapters {
  return {
    recoveryAnalyzer: new RecoveryAnalyzerAdapter(),
  };
}

// ============================================================================
// Use Case Factory Functions
// ============================================================================

/**
 * Options for creating ComputeContextUseCase.
 * All adapters are optional - defaults will be used if not provided.
 */
export interface CreateComputeContextOptions {
  locationResolver?: ILocationResolver;
  gitStateReader?: IGitStateReader;
  wuStateReader?: IWuStateReader;
}

/**
 * Create a ComputeContextUseCase with default or custom adapters.
 *
 * @example
 * // Use default adapters
 * const useCase = createComputeContextUseCase();
 * const context = await useCase.execute({ wuId: 'WU-1094' });
 *
 * @example
 * // Use custom adapters for testing
 * const useCase = createComputeContextUseCase({
 *   locationResolver: mockLocationResolver,
 * });
 */
export function createComputeContextUseCase(
  options: CreateComputeContextOptions = {},
): ComputeContextUseCase {
  const defaults = createContextAdapters();

  return new ComputeContextUseCase(
    options.locationResolver ?? defaults.locationResolver,
    options.gitStateReader ?? defaults.gitStateReader,
    options.wuStateReader ?? defaults.wuStateReader,
  );
}

/**
 * Options for creating ValidateCommandUseCase.
 */
export interface CreateValidateCommandOptions {
  commandRegistry?: ICommandRegistry;
}

/**
 * Create a ValidateCommandUseCase with default or custom registry.
 *
 * @example
 * // Use default registry
 * const useCase = createValidateCommandUseCase();
 * const result = await useCase.execute('wu:done', context);
 *
 * @example
 * // Use custom registry for testing
 * const useCase = createValidateCommandUseCase({
 *   commandRegistry: mockRegistry,
 * });
 */
export function createValidateCommandUseCase(
  options: CreateValidateCommandOptions = {},
): ValidateCommandUseCase {
  const defaults = createValidationAdapters();

  return new ValidateCommandUseCase(options.commandRegistry ?? defaults.commandRegistry);
}

/**
 * Options for creating AnalyzeRecoveryUseCase.
 */
export interface CreateAnalyzeRecoveryOptions {
  recoveryAnalyzer?: IRecoveryAnalyzer;
}

/**
 * Create an AnalyzeRecoveryUseCase with default or custom analyzer.
 *
 * @example
 * // Use default analyzer
 * const useCase = createAnalyzeRecoveryUseCase();
 * const analysis = await useCase.execute(context);
 *
 * @example
 * // Use custom analyzer for testing
 * const useCase = createAnalyzeRecoveryUseCase({
 *   recoveryAnalyzer: mockAnalyzer,
 * });
 */
export function createAnalyzeRecoveryUseCase(
  options: CreateAnalyzeRecoveryOptions = {},
): AnalyzeRecoveryUseCase {
  const defaults = createRecoveryAdapters();

  return new AnalyzeRecoveryUseCase(options.recoveryAnalyzer ?? defaults.recoveryAnalyzer);
}

// ============================================================================
// Backwards Compatible Function Exports
// ============================================================================

/**
 * Compute WU context for the given options.
 *
 * This is a convenience function that creates a use case with default adapters
 * and executes it. Use createComputeContextUseCase() for more control.
 *
 * @param options - Options including optional wuId and cwd
 * @returns Promise<WuContext> - Computed WU context
 *
 * @example
 * const context = await computeWuContext({ wuId: 'WU-1094' });
 * console.log(context.location.type); // 'main' or 'worktree'
 */
export async function computeWuContext(options: ComputeContextOptions = {}): Promise<WuContext> {
  const useCase = createComputeContextUseCase();
  return useCase.execute(options);
}

/**
 * Validate a command against the given context.
 *
 * This is a convenience function that creates a use case with default registry
 * and executes it. Use createValidateCommandUseCase() for more control.
 *
 * @param command - Command name (e.g., 'wu:done')
 * @param context - Current WU context
 * @returns Promise<ValidationResult> - Validation result
 *
 * @example
 * const context = await computeWuContext({ wuId: 'WU-1094' });
 * const result = await validateCommand('wu:done', context);
 * if (!result.valid) {
 *   console.error(result.errors[0].message);
 * }
 */
export async function validateCommand(
  command: string,
  context: WuContext,
): Promise<ValidationResult> {
  const useCase = createValidateCommandUseCase();
  return useCase.execute(command, context);
}

/**
 * Analyze recovery issues for the given context.
 *
 * This is a convenience function that creates a use case with default analyzer
 * and executes it. Use createAnalyzeRecoveryUseCase() for more control.
 *
 * @param context - Current WU context
 * @returns Promise<RecoveryAnalysis> - Recovery analysis
 *
 * @example
 * const context = await computeWuContext({ wuId: 'WU-1094' });
 * const analysis = await analyzeRecoveryIssues(context);
 * if (analysis.hasIssues) {
 *   console.log('Issues:', analysis.issues);
 *   console.log('Suggested actions:', analysis.actions);
 * }
 */
export async function analyzeRecoveryIssues(context: WuContext): Promise<RecoveryAnalysis> {
  const useCase = createAnalyzeRecoveryUseCase();
  return useCase.execute(context);
}

// Re-export types for convenience
export type { ComputeContextOptions };
