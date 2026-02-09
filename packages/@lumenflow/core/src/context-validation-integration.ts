/**
 * Context Validation Integration
 *
 * WU-1090: Context-aware state machine for WU lifecycle commands
 *
 * Shared module for integrating context validation into CLI commands.
 * Reads validation_mode from config and applies validation accordingly.
 *
 * @module
 */

import { computeContext } from './context/context-computer.js';
import { validateCommand } from './validation/validate-command.js';
import { getValidCommandsForContext } from './validation/command-registry.js';
import { getConfig } from './lumenflow-config.js';
import { EMOJI, CONTEXT_VALIDATION } from './wu-constants.js';
import { ProcessExitError } from './error-handler.js';
import type { WuContext, ValidationResult } from './validation/types.js';

const { COMMANDS } = CONTEXT_VALIDATION;

/**
 * Validation mode from config
 */
export type ValidationMode = 'off' | 'warn' | 'error';

/**
 * Result of running context validation
 */
export interface ContextValidationResult {
  /** Whether the command can proceed */
  canProceed: boolean;
  /** The computed context */
  context: WuContext;
  /** Validation result (null if validation was off) */
  validation: ValidationResult | null;
  /** Validation mode that was applied */
  mode: ValidationMode;
  /** Formatted output for display (if any) */
  output: string | null;
}

/**
 * Get validation mode from config
 */
export function getValidationMode(): ValidationMode {
  try {
    const config = getConfig();
    const experimental = config?.experimental;
    if (!experimental?.context_validation) {
      return 'off';
    }
    return (experimental.validation_mode as ValidationMode) || 'warn';
  } catch {
    // Config not available, default to warn
    return 'warn';
  }
}

/**
 * Check if next steps should be shown
 */
export function shouldShowNextSteps(): boolean {
  try {
    const config = getConfig();
    return config?.experimental?.show_next_steps !== false;
  } catch {
    return true;
  }
}

/**
 * Format validation errors for display
 */
function formatErrors(validation: ValidationResult): string {
  const lines: string[] = [];
  for (const error of validation.errors) {
    lines.push(`${EMOJI.FAILURE} ${error.code}: ${error.message}`);
    if (error.fixCommand) {
      lines.push(`   Fix: ${error.fixCommand}`);
    }
  }
  return lines.join('\n');
}

/**
 * Format validation warnings for display
 */
function formatWarnings(validation: ValidationResult): string {
  const lines: string[] = [];
  for (const warning of validation.warnings) {
    lines.push(`${EMOJI.WARNING} ${warning.id}: ${warning.message}`);
  }
  return lines.join('\n');
}

/**
 * Format next steps for display
 */
export function formatNextSteps(context: WuContext, commandName: string): string {
  const validCommands = getValidCommandsForContext(context);
  const commandDef = validCommands.find((c) => c.name === commandName);

  if (!commandDef?.getNextSteps) {
    return '';
  }

  const steps = commandDef.getNextSteps(context);
  if (steps.length === 0) {
    return '';
  }

  return '\n## Next Steps\n' + steps.map((s) => `  ${s}`).join('\n');
}

/**
 * Run context validation for a command
 *
 * @param commandName - The wu:* command name (e.g., 'wu:claim')
 * @param wuId - Optional WU ID for context
 * @returns ContextValidationResult
 */
export async function runContextValidation(
  commandName: string,
  wuId?: string,
): Promise<ContextValidationResult> {
  const mode = getValidationMode();

  // Compute context
  const { context } = await computeContext({ wuId });

  // If validation is off, just return context
  if (mode === 'off') {
    return {
      canProceed: true,
      context,
      validation: null,
      mode,
      output: null,
    };
  }

  // Run validation
  const validation = validateCommand(commandName, context);

  // Format output
  let output: string | null = null;
  if (!validation.valid) {
    output = formatErrors(validation);
  } else if (validation.warnings.length > 0) {
    output = formatWarnings(validation);
  }

  // Determine if command can proceed
  const canProceed = mode === 'warn' || validation.valid;

  return {
    canProceed,
    context,
    validation,
    mode,
    output,
  };
}

/**
 * Apply context validation to a command
 *
 * This is the main integration function. It:
 * 1. Runs validation according to config
 * 2. Logs warnings/errors as appropriate
 * 3. Returns whether the command should proceed
 * 4. Exits with error if mode is 'error' and validation fails
 *
 * @param commandName - The wu:* command name
 * @param wuId - Optional WU ID for context
 * @param logPrefix - Log prefix for output
 * @returns The computed context if validation passes
 * @throws {ProcessExitError} if mode is 'error' and validation fails (WU-1538)
 */
export async function applyContextValidation(
  commandName: string,
  wuId?: string,
  logPrefix: string = '[context]',
): Promise<WuContext> {
  const result = await runContextValidation(commandName, wuId);

  // Log output if any
  if (result.output) {
    if (result.mode === 'error' && !result.canProceed) {
      console.error(`${logPrefix} Context validation failed:`);
      console.error(result.output);
      throw new ProcessExitError(`${logPrefix} Context validation failed`, 1);
    } else if (result.mode === 'warn') {
      console.warn(`${logPrefix} Context validation warnings:`);
      console.warn(result.output);
    }
  }

  return result.context;
}

// Re-export commands for convenience
export { COMMANDS };
