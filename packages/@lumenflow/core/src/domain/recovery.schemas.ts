/**
 * Recovery Schemas
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * Zod schemas for recovery-related types in the context-aware validation system.
 * Types are inferred from Zod schemas using z.infer<> for single source of truth.
 *
 * @module domain/recovery.schemas
 */

import { z } from 'zod';

/**
 * Recovery issue code values
 *
 * Mirrors CONTEXT_VALIDATION.RECOVERY_ISSUES from wu-constants.ts
 */
export const RECOVERY_ISSUE_CODE_VALUES = [
  'PARTIAL_CLAIM',
  'ORPHAN_CLAIM',
  'INCONSISTENT_STATE',
  'ORPHAN_BRANCH',
  'STALE_LOCK',
  'LEFTOVER_WORKTREE',
] as const;

/**
 * Schema for recovery issue codes
 */
export const RecoveryIssueCodeSchema = z.enum(RECOVERY_ISSUE_CODE_VALUES);

/**
 * Recovery action type values
 *
 * Mirrors CONTEXT_VALIDATION.RECOVERY_ACTIONS from wu-constants.ts
 */
export const RECOVERY_ACTION_TYPE_VALUES = ['resume', 'reset', 'nuke', 'cleanup'] as const;

/**
 * Schema for recovery action types
 */
export const RecoveryActionTypeSchema = z.enum(RECOVERY_ACTION_TYPE_VALUES);

/**
 * Schema for recovery issue
 *
 * Issue detected during recovery analysis.
 */
export const RecoveryIssueSchema = z.object({
  /** Issue code from RECOVERY_ISSUES */
  code: RecoveryIssueCodeSchema,
  /** Human-readable description */
  description: z.string(),
  /** Additional context for the issue */
  context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for recovery action
 *
 * Suggested recovery action.
 */
export const RecoveryActionSchema = z.object({
  /** Action type from RECOVERY_ACTIONS */
  type: RecoveryActionTypeSchema,
  /** Human-readable description of what this action does */
  description: z.string(),
  /** Command to execute (copy-paste ready) */
  command: z.string(),
  /** Whether this action requires --force flag */
  requiresForce: z.boolean(),
  /** Warning message if any */
  warning: z.string().optional(),
});

/**
 * Schema for recovery analysis result
 *
 * Result of recovery analysis.
 */
export const RecoveryAnalysisSchema = z.object({
  /** Whether any issues were found */
  hasIssues: z.boolean(),
  /** List of detected issues */
  issues: z.array(RecoveryIssueSchema),
  /** Suggested recovery actions */
  actions: z.array(RecoveryActionSchema),
  /** WU ID analyzed */
  wuId: z.string().nullable(),
});

// Type inference from Zod schemas
export type RecoveryIssueCode = z.infer<typeof RecoveryIssueCodeSchema>;
export type RecoveryActionType = z.infer<typeof RecoveryActionTypeSchema>;
export type RecoveryIssue = z.infer<typeof RecoveryIssueSchema>;
export type RecoveryAction = z.infer<typeof RecoveryActionSchema>;
export type RecoveryAnalysis = z.infer<typeof RecoveryAnalysisSchema>;
