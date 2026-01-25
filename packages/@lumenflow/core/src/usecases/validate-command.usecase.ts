/**
 * ValidateCommandUseCase
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Use case for validating commands against WU context.
 * Uses constructor injection for command registry dependency.
 *
 * Hexagonal Architecture - Application Layer
 * - Depends on port interface (ICommandRegistry)
 * - Does NOT import from infrastructure layer
 *
 * @module usecases/validate-command.usecase
 */

import type { ICommandRegistry, CommandDefinition, WuContext } from '../ports/validation.ports.js';
import type { ValidationResult, ValidationError, ValidationWarning } from '../validation/types.js';
import { CONTEXT_VALIDATION } from '../wu-constants.js';

const { ERROR_CODES, SEVERITY } = CONTEXT_VALIDATION;

/**
 * ValidateCommandUseCase
 *
 * Validates a command against the current WU context, returning
 * validation errors and warnings with fix suggestions.
 *
 * @example
 * // Using default registry via DI factory
 * const useCase = createValidateCommandUseCase();
 * const result = await useCase.execute('wu:done', context);
 *
 * @example
 * // Using custom registry for testing
 * const useCase = new ValidateCommandUseCase(mockRegistry);
 * const result = await useCase.execute('wu:claim', context);
 */
export class ValidateCommandUseCase {
  constructor(private readonly commandRegistry: ICommandRegistry) {}

  /**
   * Execute the use case to validate a command.
   *
   * @param command - Command name (e.g., 'wu:done')
   * @param context - Current WU context
   * @returns Promise<ValidationResult> - Validation result with errors/warnings
   */
  async execute(command: string, context: WuContext): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    // Step 1: Look up command definition
    const commandDef = this.commandRegistry.getCommandDefinition(command);

    if (!commandDef) {
      errors.push({
        // Use WU_NOT_FOUND as a general "not found" error code
        // The message clarifies it's an unknown command
        code: ERROR_CODES.WU_NOT_FOUND,
        message: `Unknown command: ${command}`,
        fixCommand: null,
      });

      return {
        valid: false,
        errors,
        warnings,
        context,
      };
    }

    // Step 2: Check location requirement
    if (commandDef.requiredLocation !== null) {
      if (context.location.type !== commandDef.requiredLocation) {
        const fixCommand = this.getLocationFixCommand(
          commandDef.requiredLocation,
          context,
          command,
        );

        errors.push({
          code: ERROR_CODES.WRONG_LOCATION,
          message: `${command} must be run from ${commandDef.requiredLocation} checkout`,
          fixCommand,
          context: {
            required: commandDef.requiredLocation,
            actual: context.location.type,
          },
        });
      }
    }

    // Step 3: Check WU status requirement
    if (commandDef.requiredWuStatus !== null) {
      const actualStatus = context.wu?.status ?? null;

      if (actualStatus !== commandDef.requiredWuStatus) {
        errors.push({
          code: ERROR_CODES.WRONG_WU_STATUS,
          message: `${command} requires WU status '${commandDef.requiredWuStatus}' but got '${actualStatus ?? 'no WU'}'`,
          fixCommand: null,
          context: {
            required: commandDef.requiredWuStatus,
            actual: actualStatus,
          },
        });
      }
    }

    // Step 4: Check predicates
    if (commandDef.predicates && commandDef.predicates.length > 0) {
      for (const predicate of commandDef.predicates) {
        const passed = predicate.check(context);

        if (!passed) {
          const message = predicate.getFixMessage
            ? predicate.getFixMessage(context)
            : predicate.description;

          if (predicate.severity === SEVERITY.ERROR) {
            errors.push({
              // Use GATES_NOT_PASSED for predicate failures (e.g., dirty worktree)
              code: ERROR_CODES.GATES_NOT_PASSED,
              message,
              fixCommand: null,
              context: { predicateId: predicate.id },
            });
          } else {
            warnings.push({
              id: predicate.id,
              message,
            });
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      context,
    };
  }

  /**
   * Get valid commands for the current context.
   *
   * @param context - Current WU context
   * @returns Promise<CommandDefinition[]> - Array of valid commands
   */
  async getValidCommands(context: WuContext): Promise<CommandDefinition[]> {
    return this.commandRegistry.getValidCommandsForContext(context);
  }

  /**
   * Generate fix command for location errors.
   */
  private getLocationFixCommand(
    requiredLocation: string,
    context: WuContext,
    command: string,
  ): string {
    if (requiredLocation === 'main') {
      // Need to cd to main checkout
      const wuIdParam = context.wu?.id ? ` --id ${context.wu.id}` : '';
      return `cd ${context.location.mainCheckout} && pnpm ${command}${wuIdParam}`;
    } else if (requiredLocation === 'worktree') {
      // Need to cd to worktree
      if (context.location.worktreeName) {
        return `cd ${context.location.mainCheckout}/worktrees/${context.location.worktreeName}`;
      }
    }

    return '';
  }
}
