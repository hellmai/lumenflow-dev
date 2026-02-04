/**
 * @file arg-validators.ts
 * @description CLI argument validators using shared schemas (WU-1431)
 *
 * These validators use the shared Zod schemas to validate CLI arguments.
 * They handle:
 * - CLI-only alias mapping (codePath -> code_paths, manualTest -> test_paths_manual)
 * - Conditional validation (skip_gates requires reason)
 * - Normalized output for consistent downstream processing
 */

import {
  wuCreateSchema,
  wuClaimSchema,
  wuStatusSchema,
  wuDoneSchema,
  gatesSchema,
  type WuCreateInput,
  type WuClaimInput,
  type WuStatusInput,
  type WuDoneInput,
  type GatesInput,
} from './command-schemas.js';
import { getCliOnlyAliases } from './schema-utils.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Validation result with normalized data
 */
export interface ValidationResult<T> {
  valid: boolean;
  errors: string[];
  warnings: string[];
  normalized: T;
}

// =============================================================================
// CLI Alias Mapping
// =============================================================================

/**
 * Map CLI-only aliases to their canonical field names
 *
 * @param args - Raw CLI arguments (may include aliases)
 * @returns Arguments with aliases mapped to canonical names
 */
function mapCliAliases(args: Record<string, unknown>): Record<string, unknown> {
  const aliases = getCliOnlyAliases();
  const result = { ...args };

  for (const [aliasName, aliasDef] of Object.entries(aliases)) {
    if (aliasName in result) {
      const canonicalName = aliasDef.canonical;
      // Merge alias value into canonical field (arrays are concatenated)
      const aliasValue = result[aliasName];
      const canonicalValue = result[canonicalName];

      if (Array.isArray(aliasValue)) {
        if (Array.isArray(canonicalValue)) {
          result[canonicalName] = [...canonicalValue, ...aliasValue];
        } else {
          result[canonicalName] = aliasValue;
        }
      } else {
        result[canonicalName] = aliasValue;
      }

      // Remove the alias field
      delete result[aliasName];
    }
  }

  return result;
}

/**
 * Zod error issue interface (compatible with both Zod 3 and 4)
 */
interface ZodIssue {
  path: (string | number | symbol)[];
  message: string;
  code?: string;
}

/**
 * Zod error interface (compatible with both Zod 3 and 4)
 */
interface ZodErrorLike {
  issues: ZodIssue[];
}

/**
 * Format Zod errors into human-readable strings
 */
function formatZodErrors(error: ZodErrorLike): string[] {
  return error.issues.map((issue) => {
    // Convert path to string (filter out symbols)
    const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol').join('.');
    // Handle required field errors (Zod 4 uses invalid_type with "received undefined")
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
// Validators
// =============================================================================

/**
 * Validate wu:create arguments
 *
 * @param args - Raw CLI arguments
 * @returns Validation result with normalized WuCreateInput
 */
export function validateWuCreateArgs(
  args: Record<string, unknown>,
): ValidationResult<WuCreateInput> {
  const mapped = mapCliAliases(args);
  const result = wuCreateSchema.safeParse(mapped);

  if (result.success) {
    return {
      valid: true,
      errors: [],
      warnings: [],
      normalized: result.data,
    };
  }

  return {
    valid: false,
    errors: formatZodErrors(result.error),
    warnings: [],
    normalized: mapped as WuCreateInput,
  };
}

/**
 * Validate wu:claim arguments
 *
 * @param args - Raw CLI arguments
 * @returns Validation result with normalized WuClaimInput
 */
export function validateWuClaimArgs(args: Record<string, unknown>): ValidationResult<WuClaimInput> {
  const result = wuClaimSchema.safeParse(args);

  if (result.success) {
    return {
      valid: true,
      errors: [],
      warnings: [],
      normalized: result.data,
    };
  }

  return {
    valid: false,
    errors: formatZodErrors(result.error),
    warnings: [],
    normalized: args as WuClaimInput,
  };
}

/**
 * Validate wu:status arguments
 *
 * @param args - Raw CLI arguments
 * @returns Validation result with normalized WuStatusInput
 */
export function validateWuStatusArgs(
  args: Record<string, unknown>,
): ValidationResult<WuStatusInput> {
  const result = wuStatusSchema.safeParse(args);

  if (result.success) {
    return {
      valid: true,
      errors: [],
      warnings: [],
      normalized: result.data,
    };
  }

  return {
    valid: false,
    errors: formatZodErrors(result.error),
    warnings: [],
    normalized: args as WuStatusInput,
  };
}

/**
 * Validate wu:done arguments
 *
 * Includes additional validation: skip_gates requires reason
 *
 * @param args - Raw CLI arguments
 * @returns Validation result with normalized WuDoneInput
 */
export function validateWuDoneArgs(args: Record<string, unknown>): ValidationResult<WuDoneInput> {
  const result = wuDoneSchema.safeParse(args);

  if (!result.success) {
    return {
      valid: false,
      errors: formatZodErrors(result.error),
      warnings: [],
      normalized: args as WuDoneInput,
    };
  }

  // Additional validation: skip_gates requires reason
  const errors: string[] = [];
  if (result.data.skip_gates && !result.data.reason) {
    errors.push('skip_gates requires reason to be provided');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings: [],
    normalized: result.data,
  };
}

/**
 * Validate gates arguments
 *
 * @param args - Raw CLI arguments
 * @returns Validation result with normalized GatesInput
 */
export function validateGatesArgs(args: Record<string, unknown>): ValidationResult<GatesInput> {
  const result = gatesSchema.safeParse(args);

  if (result.success) {
    return {
      valid: true,
      errors: [],
      warnings: [],
      normalized: result.data,
    };
  }

  return {
    valid: false,
    errors: formatZodErrors(result.error),
    warnings: [],
    normalized: args as GatesInput,
  };
}
