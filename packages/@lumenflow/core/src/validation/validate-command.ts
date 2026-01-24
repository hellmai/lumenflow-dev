/**
 * Command Validation for WU Lifecycle Commands
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Validates commands against the current context and provides:
 * - Location validation with copy-paste fix commands
 * - WU status validation with guidance
 * - Predicate validation with severity levels
 *
 * @module
 */

import {
  CONTEXT_VALIDATION,
  type LocationType,
  type ValidationErrorCode,
} from '../wu-constants.js';
import { getCommandDefinition } from './command-registry.js';
import type {
  CommandDefinition,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  WuContext,
} from './types.js';

const { LOCATION_TYPES, ERROR_CODES, SEVERITY } = CONTEXT_VALIDATION;

/**
 * Create a validation error with fix command.
 */
function createError(
  code: ValidationErrorCode,
  message: string,
  fixCommand: string | null = null,
  context?: Record<string, unknown>,
): ValidationError {
  return { code, message, fixCommand, context };
}

/**
 * Create a validation warning.
 */
function createWarning(id: string, message: string): ValidationWarning {
  return { id, message };
}

/**
 * Get human-readable location name.
 */
function locationName(type: LocationType): string {
  switch (type) {
    case LOCATION_TYPES.MAIN:
      return 'main checkout';
    case LOCATION_TYPES.WORKTREE:
      return 'worktree';
    case LOCATION_TYPES.DETACHED:
      return 'detached HEAD';
    default:
      return 'unknown location';
  }
}

/**
 * Validate location requirement.
 */
function validateLocation(
  def: CommandDefinition,
  context: WuContext,
): ValidationError | null {
  if (def.requiredLocation === null) return null;

  const currentLocation = context.location.type;
  if (currentLocation === def.requiredLocation) return null;

  const requiredName = locationName(def.requiredLocation);
  const currentName = locationName(currentLocation);

  // Generate copy-paste fix command with actual path
  let fixCommand: string | null = null;
  if (def.requiredLocation === LOCATION_TYPES.MAIN) {
    fixCommand = `cd ${context.location.mainCheckout}`;
  } else if (def.requiredLocation === LOCATION_TYPES.WORKTREE) {
    // If we know the WU ID, suggest the expected worktree path
    if (context.wu?.id) {
      const laneKebab = (context.wu.lane || 'lane')
        .toLowerCase()
        .replace(/[: ]+/g, '-');
      const wuIdLower = context.wu.id.toLowerCase();
      fixCommand = `cd ${context.location.mainCheckout}/worktrees/${laneKebab}-${wuIdLower}`;
    }
  }

  return createError(
    ERROR_CODES.WRONG_LOCATION,
    `${def.name} requires ${requiredName}, but you are in ${currentName}`,
    fixCommand,
    {
      required: def.requiredLocation,
      current: currentLocation,
    },
  );
}

/**
 * Validate WU status requirement.
 */
function validateWuStatus(
  def: CommandDefinition,
  context: WuContext,
): ValidationError | null {
  // No status requirement means no WU needed
  if (def.requiredWuStatus === null) return null;

  // Status requirement but no WU provided
  if (context.wu === null) {
    return createError(
      ERROR_CODES.WU_NOT_FOUND,
      `${def.name} requires a WU with status '${def.requiredWuStatus}', but no WU was specified`,
      null,
      { required: def.requiredWuStatus },
    );
  }

  // Check if status matches
  if (context.wu.status !== def.requiredWuStatus) {
    return createError(
      ERROR_CODES.WRONG_WU_STATUS,
      `${def.name} requires WU status '${def.requiredWuStatus}', but ${context.wu.id} is '${context.wu.status}'`,
      null,
      {
        required: def.requiredWuStatus,
        current: context.wu.status,
        wuId: context.wu.id,
      },
    );
  }

  return null;
}

/**
 * Validate command predicates.
 */
function validatePredicates(
  def: CommandDefinition,
  context: WuContext,
): { errors: ValidationError[]; warnings: ValidationWarning[] } {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  if (!def.predicates || def.predicates.length === 0) {
    return { errors, warnings };
  }

  for (const predicate of def.predicates) {
    const passed = predicate.check(context);

    if (!passed) {
      const fixMessage = predicate.getFixMessage
        ? predicate.getFixMessage(context)
        : null;

      if (predicate.severity === SEVERITY.ERROR) {
        errors.push(
          createError(
            ERROR_CODES.GATES_NOT_PASSED, // Using as generic predicate failure
            predicate.description,
            fixMessage,
            { predicateId: predicate.id },
          ),
        );
      } else {
        warnings.push(createWarning(predicate.id, predicate.description));
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validate a command against the current context.
 *
 * Returns a ValidationResult with:
 * - valid: boolean - whether command can proceed
 * - errors: array of blocking errors with fix guidance
 * - warnings: array of non-blocking warnings
 * - context: the input context for debugging
 *
 * @param command - Command name (e.g., 'wu:done')
 * @param context - Current WU context
 * @returns ValidationResult
 */
export function validateCommand(
  command: string,
  context: WuContext,
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  // Get command definition
  const def = getCommandDefinition(command);
  if (!def) {
    errors.push(
      createError(
        ERROR_CODES.WU_NOT_FOUND, // Reusing for unknown command
        `Unknown command: ${command}`,
        null,
      ),
    );
    return { valid: false, errors, warnings, context };
  }

  // Validate location requirement
  const locationError = validateLocation(def, context);
  if (locationError) {
    errors.push(locationError);
  }

  // Validate WU status requirement
  const statusError = validateWuStatus(def, context);
  if (statusError) {
    errors.push(statusError);
  }

  // Validate predicates
  const predicateResults = validatePredicates(def, context);
  errors.push(...predicateResults.errors);
  warnings.push(...predicateResults.warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    context,
  };
}
