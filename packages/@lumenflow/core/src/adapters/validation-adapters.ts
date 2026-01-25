/**
 * Validation Adapters
 *
 * WU-1094: INIT-002 Phase 2 - Implement adapters and dependency injection
 *
 * Concrete adapter implementations for validation-related port interfaces.
 * These adapters wrap the existing implementation functions to conform
 * to the port interfaces, enabling dependency injection.
 *
 * Adapters:
 * - CommandRegistryAdapter - Implements ICommandRegistry
 *
 * @module adapters/validation-adapters
 */

import type { ICommandRegistry, CommandDefinition, WuContext } from '../ports/validation.ports.js';

// Import existing implementations
import {
  COMMAND_REGISTRY,
  getCommandDefinition,
  getValidCommandsForContext,
} from '../validation/command-registry.js';

/**
 * CommandRegistryAdapter
 *
 * Implements ICommandRegistry by delegating to the command registry functions.
 * Provides access to command definitions and context-based validation.
 *
 * @example
 * // Use default adapter
 * const adapter = new CommandRegistryAdapter();
 * const def = adapter.getCommandDefinition('wu:done');
 *
 * @example
 * // Use as port interface
 * const registry: ICommandRegistry = new CommandRegistryAdapter();
 */
export class CommandRegistryAdapter implements ICommandRegistry {
  /**
   * Get command definition by name.
   *
   * @param command - Command name (e.g., 'wu:create', 'wu:done')
   * @returns CommandDefinition or null if not found
   */
  getCommandDefinition(command: string): CommandDefinition | null {
    return getCommandDefinition(command);
  }

  /**
   * Get all commands valid for the current context.
   *
   * @param context - Current WU context
   * @returns Array of valid CommandDefinitions
   */
  getValidCommandsForContext(context: WuContext): CommandDefinition[] {
    return getValidCommandsForContext(context);
  }

  /**
   * Get all registered command definitions.
   *
   * @returns Array of all CommandDefinitions
   */
  getAllCommands(): CommandDefinition[] {
    return Array.from(COMMAND_REGISTRY.values());
  }
}
