/**
 * @file initiative-arg-validators.ts
 * @description CLI argument validators for initiative commands using shared schemas (WU-1455)
 *
 * These validators use the shared Zod schemas to validate CLI arguments for the
 * 8 initiative commands. They follow the same pattern as wu-lifecycle-arg-validators.ts
 * (WU-1454).
 */

import {
  initiativeCreateSchema,
  initiativeEditSchema,
  initiativeListSchema,
  initiativeStatusSchema,
  initiativeAddWuSchema,
  initiativeRemoveWuSchema,
  initiativeBulkAssignSchema,
  initiativePlanSchema,
  type InitiativeCreateInput,
  type InitiativeEditInput,
  type InitiativeListInput,
  type InitiativeStatusInput,
  type InitiativeAddWuInput,
  type InitiativeRemoveWuInput,
  type InitiativeBulkAssignInput,
  type InitiativePlanInput,
} from './initiative-schemas.js';

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

/** Validate initiative:create arguments */
export const validateInitiativeCreateArgs =
  createValidator<InitiativeCreateInput>(initiativeCreateSchema);

/** Validate initiative:edit arguments */
export const validateInitiativeEditArgs =
  createValidator<InitiativeEditInput>(initiativeEditSchema);

/** Validate initiative:list arguments */
export const validateInitiativeListArgs =
  createValidator<InitiativeListInput>(initiativeListSchema);

/** Validate initiative:status arguments */
export const validateInitiativeStatusArgs =
  createValidator<InitiativeStatusInput>(initiativeStatusSchema);

/** Validate initiative:add-wu arguments */
export const validateInitiativeAddWuArgs =
  createValidator<InitiativeAddWuInput>(initiativeAddWuSchema);

/** Validate initiative:remove-wu arguments */
export const validateInitiativeRemoveWuArgs =
  createValidator<InitiativeRemoveWuInput>(initiativeRemoveWuSchema);

/** Validate initiative:bulk-assign arguments */
export const validateInitiativeBulkAssignArgs = createValidator<InitiativeBulkAssignInput>(
  initiativeBulkAssignSchema,
);

/** Validate initiative:plan arguments */
export const validateInitiativePlanArgs =
  createValidator<InitiativePlanInput>(initiativePlanSchema);
