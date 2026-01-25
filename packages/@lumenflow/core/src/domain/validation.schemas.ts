/**
 * Validation Schemas
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * Zod schemas for validation-related types in the context-aware validation system.
 * Types are inferred from Zod schemas using z.infer<> for single source of truth.
 *
 * @module domain/validation.schemas
 */

import { z } from 'zod';
import { LocationTypeSchema } from './context.schemas.js';

// Re-export LocationTypeSchema for command definitions
export { LocationTypeSchema };

/**
 * Validation error code values
 *
 * Mirrors CONTEXT_VALIDATION.ERROR_CODES from wu-constants.ts
 */
export const VALIDATION_ERROR_CODE_VALUES = [
  'WRONG_LOCATION',
  'WU_NOT_FOUND',
  'WU_ALREADY_EXISTS',
  'WRONG_WU_STATUS',
  'LANE_OCCUPIED',
  'WORKTREE_EXISTS',
  'WORKTREE_MISSING',
  'GATES_NOT_PASSED',
  'DIRTY_GIT',
  'REMOTE_UNAVAILABLE',
  'INCONSISTENT_STATE',
] as const;

/**
 * Schema for validation error codes
 */
export const ValidationErrorCodeSchema = z.enum(VALIDATION_ERROR_CODE_VALUES);

/**
 * Severity values
 *
 * Mirrors CONTEXT_VALIDATION.SEVERITY from wu-constants.ts
 */
export const PREDICATE_SEVERITY_VALUES = ['error', 'warning'] as const;

/**
 * Schema for predicate severity
 */
export const PredicateSeveritySchema = z.enum(PREDICATE_SEVERITY_VALUES);

/**
 * Schema for validation error with fix guidance
 */
export const ValidationErrorSchema = z.object({
  /** Error code */
  code: ValidationErrorCodeSchema,
  /** Human-readable message */
  message: z.string(),
  /** Copy-paste ready fix command (if available) */
  fixCommand: z.string().nullable(),
  /** Additional context for debugging */
  context: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Schema for validation warning (non-blocking)
 */
export const ValidationWarningSchema = z.object({
  /** Warning ID */
  id: z.string(),
  /** Human-readable message */
  message: z.string(),
});

/**
 * Schema for validation result (partial, without context for serialization)
 *
 * Note: The full ValidationResult in types.ts includes the context object,
 * but this schema is for serializable results without the context.
 */
export const ValidationResultSchema = z.object({
  /** Whether command can proceed */
  valid: z.boolean(),
  /** Errors that block execution */
  errors: z.array(ValidationErrorSchema),
  /** Warnings that don't block execution */
  warnings: z.array(ValidationWarningSchema),
});

/**
 * Schema for command predicate configuration (serializable)
 *
 * This schema represents the serializable configuration of a predicate,
 * not the full CommandPredicate which includes the check function.
 */
export const CommandPredicateConfigSchema = z.object({
  /** Unique identifier for the predicate */
  id: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** Severity: 'error' blocks execution, 'warning' allows with warning */
  severity: PredicateSeveritySchema,
});

/**
 * Schema for command definition configuration (serializable)
 *
 * This schema represents the serializable configuration of a command definition,
 * not the full CommandDefinition which includes function references.
 */
export const CommandDefinitionConfigSchema = z.object({
  /** Command name (e.g., 'wu:create') */
  name: z.string(),
  /** Human-readable description */
  description: z.string(),
  /** Required location type (null = any location) */
  requiredLocation: LocationTypeSchema.nullable(),
  /** Required WU status (null = no status requirement) */
  requiredWuStatus: z.string().nullable(),
  /** Predicate IDs for additional checks */
  predicateIds: z.array(z.string()),
});

// Type inference from Zod schemas
export type ValidationErrorCode = z.infer<typeof ValidationErrorCodeSchema>;
export type PredicateSeverity = z.infer<typeof PredicateSeveritySchema>;
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
export type ValidationWarning = z.infer<typeof ValidationWarningSchema>;
export type ValidationResult = z.infer<typeof ValidationResultSchema>;
export type CommandPredicateConfig = z.infer<typeof CommandPredicateConfigSchema>;
export type CommandDefinitionConfig = z.infer<typeof CommandDefinitionConfigSchema>;
