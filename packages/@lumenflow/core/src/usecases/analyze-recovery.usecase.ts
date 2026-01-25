/**
 * AnalyzeRecoveryUseCase
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Use case for analyzing WU state and suggesting recovery actions.
 * Uses constructor injection for recovery analyzer dependency.
 *
 * Hexagonal Architecture - Application Layer
 * - Depends on port interface (IRecoveryAnalyzer)
 * - Does NOT import from infrastructure layer
 *
 * @module usecases/analyze-recovery.usecase
 */

import type { IRecoveryAnalyzer, WuContext, RecoveryAnalysis } from '../ports/recovery.ports.js';

/**
 * AnalyzeRecoveryUseCase
 *
 * Analyzes WU context to detect state inconsistencies and suggests
 * recovery actions.
 *
 * @example
 * // Using default analyzer via DI factory
 * const useCase = createAnalyzeRecoveryUseCase();
 * const analysis = await useCase.execute(context);
 *
 * @example
 * // Using custom analyzer for testing
 * const useCase = new AnalyzeRecoveryUseCase(mockAnalyzer);
 * const analysis = await useCase.execute(context);
 */
export class AnalyzeRecoveryUseCase {
  constructor(private readonly recoveryAnalyzer: IRecoveryAnalyzer) {}

  /**
   * Execute the use case to analyze recovery issues.
   *
   * @param context - Current WU context
   * @returns Promise<RecoveryAnalysis> - Analysis with issues and suggested actions
   */
  async execute(context: WuContext): Promise<RecoveryAnalysis> {
    return this.recoveryAnalyzer.analyzeRecovery(context);
  }
}
