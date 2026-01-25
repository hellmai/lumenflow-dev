/**
 * Recovery Analyzer for WU State Issues
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
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
 * @module
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTEXT_VALIDATION,
  WU_STATUS,
  DEFAULTS,
  toKebab,
  type RecoveryActionType,
  type RecoveryIssueCode,
} from '../wu-constants.js';
import type { WuContext } from '../validation/types.js';

const { RECOVERY_ISSUES, RECOVERY_ACTIONS } = CONTEXT_VALIDATION;

/**
 * Issue detected during recovery analysis.
 */
export interface RecoveryIssue {
  /** Issue code from RECOVERY_ISSUES */
  code: RecoveryIssueCode;
  /** Human-readable description */
  description: string;
  /** Additional context for the issue */
  context?: Record<string, unknown>;
}

/**
 * Suggested recovery action.
 */
export interface WuRecoveryAction {
  /** Action type from RECOVERY_ACTIONS */
  type: RecoveryActionType;
  /** Human-readable description of what this action does */
  description: string;
  /** Command to execute (copy-paste ready) */
  command: string;
  /** Whether this action requires --force flag */
  requiresForce: boolean;
  /** Warning message if any */
  warning?: string;
}

/**
 * Result of recovery analysis.
 */
export interface RecoveryAnalysis {
  /** Whether any issues were found */
  hasIssues: boolean;
  /** List of detected issues */
  issues: RecoveryIssue[];
  /** Suggested recovery actions */
  actions: WuRecoveryAction[];
  /** WU ID analyzed */
  wuId: string | null;
}

/**
 * Get expected worktree path for a WU.
 */
function getExpectedWorktreePath(mainCheckout: string, lane: string, wuId: string): string {
  const laneKebab = toKebab(lane);
  const wuIdLower = wuId.toLowerCase();
  return join(mainCheckout, DEFAULTS.WORKTREES_DIR, `${laneKebab}-${wuIdLower}`);
}

/**
 * Check if worktree exists for a WU.
 */
function worktreeExists(mainCheckout: string, lane: string, wuId: string): boolean {
  const worktreePath = getExpectedWorktreePath(mainCheckout, lane, wuId);
  return existsSync(worktreePath);
}

/**
 * Analyze context for recovery issues.
 *
 * @param context - Current WU context
 * @returns Recovery analysis with issues and suggested actions
 */
export async function analyzeRecovery(context: WuContext): Promise<RecoveryAnalysis> {
  const issues: RecoveryIssue[] = [];
  const actions: WuRecoveryAction[] = [];

  // No WU context means nothing to analyze
  if (!context.wu) {
    return {
      hasIssues: false,
      issues: [],
      actions: [],
      wuId: null,
    };
  }

  const { wu } = context;
  const mainCheckout = context.location.mainCheckout;
  const hasWorktree = worktreeExists(mainCheckout, wu.lane, wu.id);
  const worktreePath = getExpectedWorktreePath(mainCheckout, wu.lane, wu.id);

  // Check for partial claim: worktree exists but status is ready
  if (hasWorktree && wu.status === WU_STATUS.READY) {
    issues.push({
      code: RECOVERY_ISSUES.PARTIAL_CLAIM,
      description: `Worktree exists for ${wu.id} but status is 'ready'. The claim may have been interrupted.`,
      context: { worktreePath, status: wu.status },
    });

    actions.push({
      type: RECOVERY_ACTIONS.RESUME,
      description: 'Reconcile state and continue working (preserves work)',
      command: `pnpm wu:recover --id ${wu.id} --action resume`,
      requiresForce: false,
    });

    actions.push({
      type: RECOVERY_ACTIONS.RESET,
      description: 'Discard worktree and reset WU to ready',
      command: `pnpm wu:recover --id ${wu.id} --action reset`,
      requiresForce: false,
      warning: 'This will discard any uncommitted work in the worktree',
    });
  }

  // Check for orphan claim: status is in_progress but worktree missing
  if (!hasWorktree && wu.status === WU_STATUS.IN_PROGRESS) {
    issues.push({
      code: RECOVERY_ISSUES.ORPHAN_CLAIM,
      description: `${wu.id} is 'in_progress' but worktree is missing. The worktree may have been manually deleted.`,
      context: { expectedPath: worktreePath, status: wu.status },
    });

    actions.push({
      type: RECOVERY_ACTIONS.RESET,
      description: 'Reset WU status back to ready for re-claiming',
      command: `pnpm wu:recover --id ${wu.id} --action reset`,
      requiresForce: false,
    });
  }

  // Check for leftover worktree: WU is done but worktree exists
  if (hasWorktree && wu.status === WU_STATUS.DONE) {
    issues.push({
      code: RECOVERY_ISSUES.LEFTOVER_WORKTREE,
      description: `${wu.id} is 'done' but worktree still exists. The cleanup may have failed.`,
      context: { worktreePath, status: wu.status },
    });

    actions.push({
      type: RECOVERY_ACTIONS.CLEANUP,
      description: 'Remove leftover worktree for completed WU',
      command: `pnpm wu:recover --id ${wu.id} --action cleanup`,
      requiresForce: false,
    });
  }

  // Check for inconsistent state
  if (!wu.isConsistent && wu.inconsistencyReason) {
    issues.push({
      code: RECOVERY_ISSUES.INCONSISTENT_STATE,
      description: wu.inconsistencyReason,
      context: { wuId: wu.id },
    });

    actions.push({
      type: RECOVERY_ACTIONS.RESET,
      description: 'Reconcile YAML and state store',
      command: `pnpm wu:recover --id ${wu.id} --action reset`,
      requiresForce: false,
    });
  }

  return {
    hasIssues: issues.length > 0,
    issues,
    actions,
    wuId: wu.id,
  };
}
