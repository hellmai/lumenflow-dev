/**
 * @file memory-arg-validators.ts
 * @description CLI argument validators for memory commands using shared schemas (WU-1456)
 *
 * These validators use the shared Zod schemas to validate CLI arguments for the
 * 13 memory commands. They follow the same pattern as initiative-arg-validators.ts
 * (WU-1455).
 */

import {
  memInitSchema,
  memStartSchema,
  memReadySchema,
  memCheckpointSchema,
  memCleanupSchema,
  memContextSchema,
  memCreateSchema,
  memDeleteSchema,
  memExportSchema,
  memInboxSchema,
  memSignalSchema,
  memSummarizeSchema,
  memTriageSchema,
  type MemInitInput,
  type MemStartInput,
  type MemReadyInput,
  type MemCheckpointInput,
  type MemCleanupInput,
  type MemContextInput,
  type MemCreateInput,
  type MemDeleteInput,
  type MemExportInput,
  type MemInboxInput,
  type MemSignalInput,
  type MemSummarizeInput,
  type MemTriageInput,
} from './memory-schemas.js';

import type { ValidationResult } from './arg-validators.js';

// =============================================================================
// Zod Error Formatting (shared with arg-validators.ts)
// =============================================================================

/**
 * Zod error issue interface (compatible with both Zod 3 and 4)
 */
interface ZodIssue {
  path: (string | number | symbol)[];
  message: string;
  code?: string;
}

interface ZodErrorLike {
  issues: ZodIssue[];
}

function formatZodErrors(error: ZodErrorLike): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol').join('.');
    if (issue.code === 'invalid_type' && issue.message.includes('received undefined')) {
      return `${path} is required`;
    }
    if (issue.message === 'Required') {
      return `${path} is required`;
    }
    return `${path}: ${issue.message}`;
  });
}

// =============================================================================
// Generic Validator Factory
// =============================================================================

/**
 * Zod safeParse result type (compatible with both Zod 3 and 4)
 */
interface ZodSafeParseResult<T> {
  success: boolean;
  data?: T;
  error?: ZodErrorLike;
}

/**
 * Create a validator function from a Zod schema
 */
function createValidator<T>(schema: {
  safeParse: (data: unknown) => ZodSafeParseResult<T>;
}): (args: Record<string, unknown>) => ValidationResult<T> {
  return (args: Record<string, unknown>): ValidationResult<T> => {
    const result = schema.safeParse(args);

    if (result.success && result.data !== undefined) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        normalized: result.data,
      };
    }

    return {
      valid: false,
      errors: result.error ? formatZodErrors(result.error) : ['Validation failed'],
      warnings: [],
      normalized: args as T,
    };
  };
}

// =============================================================================
// Validators
// =============================================================================

/** Validate mem:init arguments */
export const validateMemInitArgs = createValidator<MemInitInput>(memInitSchema);

/** Validate mem:start arguments */
export const validateMemStartArgs = createValidator<MemStartInput>(memStartSchema);

/** Validate mem:ready arguments */
export const validateMemReadyArgs = createValidator<MemReadyInput>(memReadySchema);

/** Validate mem:checkpoint arguments */
export const validateMemCheckpointArgs = createValidator<MemCheckpointInput>(memCheckpointSchema);

/** Validate mem:cleanup arguments */
export const validateMemCleanupArgs = createValidator<MemCleanupInput>(memCleanupSchema);

/** Validate mem:context arguments */
export const validateMemContextArgs = createValidator<MemContextInput>(memContextSchema);

/** Validate mem:create arguments */
export const validateMemCreateArgs = createValidator<MemCreateInput>(memCreateSchema);

/** Validate mem:delete arguments */
export const validateMemDeleteArgs = createValidator<MemDeleteInput>(memDeleteSchema);

/** Validate mem:export arguments */
export const validateMemExportArgs = createValidator<MemExportInput>(memExportSchema);

/** Validate mem:inbox arguments */
export const validateMemInboxArgs = createValidator<MemInboxInput>(memInboxSchema);

/** Validate mem:signal arguments */
export const validateMemSignalArgs = createValidator<MemSignalInput>(memSignalSchema);

/** Validate mem:summarize arguments */
export const validateMemSummarizeArgs = createValidator<MemSummarizeInput>(memSummarizeSchema);

/** Validate mem:triage arguments */
export const validateMemTriageArgs = createValidator<MemTriageInput>(memTriageSchema);
