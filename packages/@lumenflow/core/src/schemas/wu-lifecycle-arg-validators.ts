/**
 * @file wu-lifecycle-arg-validators.ts
 * @description CLI argument validators for WU lifecycle commands using shared schemas (WU-1454)
 *
 * These validators use the shared Zod schemas to validate CLI arguments for the
 * 16 WU lifecycle commands. They follow the same pattern as arg-validators.ts (WU-1431).
 */

import {
  wuBlockSchema,
  wuUnblockSchema,
  wuEditSchema,
  wuReleaseSchema,
  wuRecoverSchema,
  wuRepairSchema,
  wuDepsSchema,
  wuPrepSchema,
  wuPreflightSchema,
  wuPruneSchema,
  wuDeleteSchema,
  wuCleanupSchema,
  wuSpawnSchema,
  wuValidateSchema,
  wuInferLaneSchema,
  wuUnlockLaneSchema,
  type WuBlockInput,
  type WuUnblockInput,
  type WuEditInput,
  type WuReleaseInput,
  type WuRecoverInput,
  type WuRepairInput,
  type WuDepsInput,
  type WuPrepInput,
  type WuPreflightInput,
  type WuPruneInput,
  type WuDeleteInput,
  type WuCleanupInput,
  type WuSpawnInput,
  type WuValidateInput,
  type WuInferLaneInput,
  type WuUnlockLaneInput,
} from './wu-lifecycle-schemas.js';

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

/** Validate wu:block arguments */
export const validateWuBlockArgs = createValidator<WuBlockInput>(wuBlockSchema);

/** Validate wu:unblock arguments */
export const validateWuUnblockArgs = createValidator<WuUnblockInput>(wuUnblockSchema);

/** Validate wu:edit arguments */
export const validateWuEditArgs = createValidator<WuEditInput>(wuEditSchema);

/** Validate wu:release arguments */
export const validateWuReleaseArgs = createValidator<WuReleaseInput>(wuReleaseSchema);

/** Validate wu:recover arguments */
export const validateWuRecoverArgs = createValidator<WuRecoverInput>(wuRecoverSchema);

/** Validate wu:repair arguments */
export const validateWuRepairArgs = createValidator<WuRepairInput>(wuRepairSchema);

/** Validate wu:deps arguments */
export const validateWuDepsArgs = createValidator<WuDepsInput>(wuDepsSchema);

/** Validate wu:prep arguments */
export const validateWuPrepArgs = createValidator<WuPrepInput>(wuPrepSchema);

/** Validate wu:preflight arguments */
export const validateWuPreflightArgs = createValidator<WuPreflightInput>(wuPreflightSchema);

/** Validate wu:prune arguments */
export const validateWuPruneArgs = createValidator<WuPruneInput>(wuPruneSchema);

/** Validate wu:delete arguments */
export const validateWuDeleteArgs = createValidator<WuDeleteInput>(wuDeleteSchema);

/** Validate wu:cleanup arguments */
export const validateWuCleanupArgs = createValidator<WuCleanupInput>(wuCleanupSchema);

/** Validate wu:brief arguments (WU-1603: same schema as wu:spawn) */
export const validateWuBriefArgs = createValidator<WuSpawnInput>(wuSpawnSchema);

/** Validate wu:spawn arguments */
export const validateWuSpawnArgs = createValidator<WuSpawnInput>(wuSpawnSchema);

/** Validate wu:validate arguments */
export const validateWuValidateArgs = createValidator<WuValidateInput>(wuValidateSchema);

/** Validate wu:infer-lane arguments */
export const validateWuInferLaneArgs = createValidator<WuInferLaneInput>(wuInferLaneSchema);

/** Validate wu:unlock-lane arguments */
export const validateWuUnlockLaneArgs = createValidator<WuUnlockLaneInput>(wuUnlockLaneSchema);
