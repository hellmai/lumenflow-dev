/**
 * @file flow-arg-validators.ts
 * @description CLI argument validators for flow/metrics commands using shared schemas (WU-1457)
 *
 * These validators use the shared Zod schemas to validate CLI arguments for the
 * 4 flow/metrics commands. They follow the same pattern as memory-arg-validators.ts
 * (WU-1456).
 */

import {
  flowBottlenecksSchema,
  flowReportSchema,
  metricsSnapshotSchema,
  metricsSchema,
  type FlowBottlenecksInput,
  type FlowReportInput,
  type MetricsSnapshotInput,
  type MetricsInput,
} from './flow-schemas.js';

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

/** Validate flow:bottlenecks arguments */
export const validateFlowBottlenecksArgs =
  createValidator<FlowBottlenecksInput>(flowBottlenecksSchema);

/** Validate flow:report arguments */
export const validateFlowReportArgs = createValidator<FlowReportInput>(flowReportSchema);

/** Validate metrics:snapshot arguments */
export const validateMetricsSnapshotArgs =
  createValidator<MetricsSnapshotInput>(metricsSnapshotSchema);

/** Validate metrics arguments */
export const validateMetricsArgs = createValidator<MetricsInput>(metricsSchema);
