/**
 * Validation Ports
 *
 * WU-1093: INIT-002 Phase 1 - Define ports and domain schemas
 *
 * Port interfaces for validation-related operations.
 * These abstractions allow external users to inject custom implementations.
 *
 * Hexagonal Architecture - Input Ports:
 * - ICommandRegistry: Lookup command definitions and validate commands
 *
 * Current Implementations:
 * - COMMAND_REGISTRY, getCommandDefinition, getValidCommandsForContext (command-registry.ts)
 *
 * @module ports/validation
 */

import type { CommandDefinition, WuContext } from '../validation/types.js';

/**
 * Command Registry Port Interface
 *
 * Provides command definitions and validation logic for wu:* commands.
 * Allows looking up command requirements and determining valid commands
 * for a given context.
 *
 * @example
 * // Custom implementation for testing
 * const mockRegistry: ICommandRegistry = {
 *   getCommandDefinition: (cmd) => cmd === 'wu:done' ? {...} : null,
 *   getValidCommandsForContext: (ctx) => [...],
 *   getAllCommands: () => [...],
 * };
 *
 * @example
 * // Using default implementation
 * import {
 *   getCommandDefinition,
 *   getValidCommandsForContext,
 *   COMMAND_REGISTRY,
 * } from './validation/command-registry.js';
 *
 * const registry: ICommandRegistry = {
 *   getCommandDefinition,
 *   getValidCommandsForContext,
 *   getAllCommands: () => Array.from(COMMAND_REGISTRY.values()),
 * };
 */
export interface ICommandRegistry {
  /**
   * Get command definition by name.
   *
   * @param command - Command name (e.g., 'wu:create', 'wu:done')
   * @returns CommandDefinition or null if not found
   */
  getCommandDefinition(command: string): CommandDefinition | null;

  /**
   * Get all commands valid for the current context.
   *
   * A command is valid if:
   * - Location requirement is satisfied (or null = any)
   * - WU status requirement is satisfied (or null = no WU required)
   * - All error-severity predicates pass
   *
   * @param context - Current WU context
   * @returns Array of valid CommandDefinitions
   */
  getValidCommandsForContext(context: WuContext): CommandDefinition[];

  /**
   * Get all registered command definitions.
   *
   * @returns Array of all CommandDefinitions
   */
  getAllCommands(): CommandDefinition[];
}

// Re-export types for convenience
export type { CommandDefinition, WuContext };
