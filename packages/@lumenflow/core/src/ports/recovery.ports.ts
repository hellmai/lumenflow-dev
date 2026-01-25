/**
 * Recovery Ports
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * Port interfaces for recovery-related operations.
 * These abstractions allow external users to inject custom implementations.
 *
 * Hexagonal Architecture - Input Ports:
 * - IRecoveryAnalyzer: Analyze WU state issues and suggest recovery actions
 *
 * Current Implementations:
 * - analyzeRecovery (recovery-analyzer.ts)
 *
 * @module ports/recovery
 */

import type { WuContext } from '../validation/types.js';
import type { RecoveryAnalysis } from '../recovery/recovery-analyzer.js';

/**
 * Recovery Analyzer Port Interface
 *
 * Analyzes WU context to detect state inconsistencies and suggests
 * appropriate recovery actions.
 *
 * Issue types detected:
 * - Partial claim: worktree exists but status is ready
 * - Orphan claim: status is in_progress but worktree missing
 * - Inconsistent state: YAML and state store disagree
 * - Orphan branch: branch exists but worktree missing
 * - Stale lock: lock file from old session
 * - Leftover worktree: WU is done but worktree exists
 *
 * @example
 * // Custom implementation for testing
 * const mockAnalyzer: IRecoveryAnalyzer = {
 *   analyzeRecovery: async (context) => ({
 *     hasIssues: false,
 *     issues: [],
 *     actions: [],
 *     wuId: context.wu?.id ?? null,
 *   }),
 * };
 *
 * @example
 * // Using default implementation
 * import { analyzeRecovery } from './recovery/recovery-analyzer.js';
 * const analyzer: IRecoveryAnalyzer = { analyzeRecovery };
 */
export interface IRecoveryAnalyzer {
  /**
   * Analyze context for recovery issues.
   *
   * @param context - Current WU context
   * @returns Promise<RecoveryAnalysis> - Recovery analysis with issues and suggested actions
   */
  analyzeRecovery(context: WuContext): Promise<RecoveryAnalysis>;
}

// Re-export types for convenience
export type { WuContext, RecoveryAnalysis };
