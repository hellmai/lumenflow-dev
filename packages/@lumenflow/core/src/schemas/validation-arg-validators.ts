/**
 * @file validation-arg-validators.ts
 * @description CLI argument validators for validation commands using shared schemas (WU-1457)
 *
 * These validators use the shared Zod schemas to validate CLI arguments for the
 * 5 validation commands. They follow the same pattern as memory-arg-validators.ts
 * (WU-1456).
 */

import {
  validateSchema,
  validateAgentSkillsSchema,
  validateAgentSyncSchema,
  validateBacklogSyncSchema,
  validateSkillsSpecSchema,
  type ValidateInput,
  type ValidateAgentSkillsInput,
  type ValidateAgentSyncInput,
  type ValidateBacklogSyncInput,
  type ValidateSkillsSpecInput,
} from './validation-schemas.js';

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

/** Validate validate arguments */
export const validateValidateArgs = createValidator<ValidateInput>(validateSchema);

/** Validate validate:agent-skills arguments */
export const validateValidateAgentSkillsArgs =
  createValidator<ValidateAgentSkillsInput>(validateAgentSkillsSchema);

/** Validate validate:agent-sync arguments */
export const validateValidateAgentSyncArgs =
  createValidator<ValidateAgentSyncInput>(validateAgentSyncSchema);

/** Validate validate:backlog-sync arguments */
export const validateValidateBacklogSyncArgs =
  createValidator<ValidateBacklogSyncInput>(validateBacklogSyncSchema);

/** Validate validate:skills-spec arguments */
export const validateValidateSkillsSpecArgs =
  createValidator<ValidateSkillsSpecInput>(validateSkillsSpecSchema);
