/**
 * Recovery Adapters
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Concrete adapter implementations for recovery-related port interfaces.
 * These adapters wrap the existing implementation functions to conform
 * to the port interfaces, enabling dependency injection.
 *
 * Adapters:
 * - RecoveryAnalyzerAdapter - Implements IRecoveryAnalyzer
 *
 * @module adapters/recovery-adapters
 */

import type { IRecoveryAnalyzer, WuContext, RecoveryAnalysis } from '../ports/recovery.ports.js';

// Import existing implementation
import { analyzeRecovery } from '../recovery/recovery-analyzer.js';

/**
 * RecoveryAnalyzerAdapter
 *
 * Implements IRecoveryAnalyzer by delegating to the analyzeRecovery function.
 * Analyzes WU context to detect state inconsistencies and suggests
 * recovery actions.
 *
 * @example
 * // Use default adapter
 * const adapter = new RecoveryAnalyzerAdapter();
 * const analysis = await adapter.analyzeRecovery(context);
 *
 * @example
 * // Use as port interface
 * const analyzer: IRecoveryAnalyzer = new RecoveryAnalyzerAdapter();
 */
export class RecoveryAnalyzerAdapter implements IRecoveryAnalyzer {
  /**
   * Analyze context for recovery issues.
   *
   * @param context - Current WU context
   * @returns Promise<RecoveryAnalysis> - Recovery analysis with issues and suggested actions
   */
  async analyzeRecovery(context: WuContext): Promise<RecoveryAnalysis> {
    return analyzeRecovery(context);
  }
}
